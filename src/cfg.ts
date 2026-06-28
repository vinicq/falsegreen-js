/**
 * Intra-test structured reachability, backing C20 (dead code) and C21 (no
 * unconditional assertion). JS test bodies are structured (no goto), so this is a
 * recursive walk over the statement tree, not a full control-flow graph.
 *
 * Two questions, both FP-averse (a false positive is worse than a miss):
 *   assertionsInDeadCode  - assertions at a position control can never reach.
 *   hasUnconditionalAssertion - is at least one assertion guaranteed to run?
 *
 * The assertion predicate and literal-truthiness helper are passed in (they live in
 * rules.ts) so this module imports nothing from there and there is no cycle.
 */
import ts from "typescript";

type IsAssertion = (n: ts.Node) => boolean;
type LitTruth = (e: ts.Expression | undefined) => boolean | null;

/** A call to process.exit(...) — control leaves the process, so it terminates. */
function isProcessExit(e: ts.Expression): boolean {
  return (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === "exit" &&
    ts.isIdentifier(e.expression.expression) &&
    e.expression.expression.text === "process"
  );
}

/**
 * A statement does not fall through to the next statement in its list iff control
 * cannot continue past it. `breakStops` controls whether break/continue count as
 * not-falling-through: true within a normal statement list (the sibling after a
 * break is unreachable), false when asking whether a switch escapes its own exit
 * (a case ending in `break` continues after the switch, so it does fall through).
 */
function stmtNoFallThrough(stmt: ts.Statement, breakStops: boolean): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) return breakStops;
  if (ts.isExpressionStatement(stmt) && isProcessExit(stmt.expression)) return true;
  if (ts.isBlock(stmt)) return listNoFallThrough(stmt.statements, breakStops);
  if (ts.isLabeledStatement(stmt)) return stmtNoFallThrough(stmt.statement, breakStops);
  if (ts.isIfStatement(stmt)) {
    return (
      stmt.elseStatement !== undefined &&
      stmtNoFallThrough(stmt.thenStatement, breakStops) &&
      stmtNoFallThrough(stmt.elseStatement, breakStops)
    );
  }
  if (ts.isTryStatement(stmt)) return tryNoFallThrough(stmt, breakStops);
  if (ts.isSwitchStatement(stmt)) return switchNoFallThrough(stmt);
  // loops may run zero times, so they always fall through; var/expr/etc fall through.
  return false;
}

function listNoFallThrough(stmts: readonly ts.Statement[], breakStops: boolean): boolean {
  return stmts.some((s) => stmtNoFallThrough(s, breakStops));
}

function tryNoFallThrough(t: ts.TryStatement, breakStops: boolean): boolean {
  // finally always runs; if it escapes, the whole try escapes.
  if (t.finallyBlock && listNoFallThrough(t.finallyBlock.statements, breakStops)) return true;
  if (!listNoFallThrough(t.tryBlock.statements, breakStops)) return false;
  // try-block escapes; if there is a catch, a caught throw escapes only if catch does too.
  if (!t.catchClause) return true;
  return listNoFallThrough(t.catchClause.block.statements, breakStops);
}

function switchNoFallThrough(sw: ts.SwitchStatement): boolean {
  // code after the switch is unreachable iff every clause escapes the function
  // (return/throw/process.exit — a `break` exits to AFTER the switch, so it does
  // NOT escape) and a default clause is present (else a no-match falls through).
  let hasDefault = false;
  for (const clause of sw.caseBlock.clauses) {
    if (clause.kind === ts.SyntaxKind.DefaultClause) hasDefault = true;
    if (!listNoFallThrough(clause.statements, /* breakStops */ false)) return false;
  }
  return hasDefault;
}

/** Collect assertion nodes under `node`, never entering a nested function scope
 *  (a return/assert inside a callback belongs to that callback, not this test). */
function collectAssertionsNoNesting(node: ts.Node, isAssertion: IsAssertion, out: ts.Node[]): void {
  const visit = (n: ts.Node): void => {
    if (isAssertion(n)) out.push(n);
    if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  if (isAssertion(node)) out.push(node);
}

/**
 * Assertions sitting at a position control can never reach (C20). Walk each
 * statement list keeping `reachable` (true at the head); once a statement does not
 * fall through, the rest of the list is dead. Recurse into nested lists of a
 * reachable statement with a fresh reachable=true. Stop at nested functions.
 */
export function assertionsInDeadCode(body: ts.Block, isAssertion: IsAssertion): ts.Node[] {
  const dead: ts.Node[] = [];

  const walkList = (stmts: readonly ts.Statement[]): void => {
    let reachable = true;
    for (const st of stmts) {
      if (!reachable) {
        collectAssertionsNoNesting(st, isAssertion, dead);
      } else {
        recurse(st);
        if (stmtNoFallThrough(st, /* breakStops */ true)) reachable = false;
      }
    }
  };

  // Descend into the nested statement lists of a reachable statement, each a fresh
  // list. Never enters a function body (its returns are its own).
  const recurse = (st: ts.Node): void => {
    if (ts.isBlock(st)) return walkList(st.statements);
    if (ts.isIfStatement(st)) {
      recurse(st.thenStatement);
      if (st.elseStatement) recurse(st.elseStatement);
      return;
    }
    if (
      ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) ||
      ts.isWhileStatement(st) || ts.isDoStatement(st)
    ) {
      return recurse(st.statement);
    }
    if (ts.isLabeledStatement(st)) return recurse(st.statement);
    if (ts.isTryStatement(st)) {
      walkList(st.tryBlock.statements);
      if (st.catchClause) walkList(st.catchClause.block.statements);
      if (st.finallyBlock) walkList(st.finallyBlock.statements);
      return;
    }
    if (ts.isSwitchStatement(st)) {
      for (const clause of st.caseBlock.clauses) walkList(clause.statements);
      return;
    }
    // expression/variable/etc: no nested statement list to walk (nested functions
    // are skipped on purpose).
  };

  walkList(body.statements);
  return dead;
}

/**
 * Is at least one assertion guaranteed to run (so C21 must NOT fire)? Walks the
 * "spine" of always-executed positions: top-level statements, blocks on the spine,
 * the taken branch of an if/?: with a literal-constant condition, finally blocks,
 * and - conservatively - a try block. A non-const if, any loop, switch, catch, or
 * short-circuit is not guaranteed. Anything unmodeled is treated as guaranteed
 * (suppress C21) to stay false-positive-averse.
 */
export function hasUnconditionalAssertion(
  body: ts.Block,
  isAssertion: IsAssertion,
  litTruth: LitTruth,
): boolean {
  // An assertion that is itself the spine expression (not behind a short-circuit
  // or ternary): expect(...).m(), await expect(...), (expect(...)).
  const directAssertion = (e: ts.Expression): boolean => {
    if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) {
      return directAssertion(e.expression);
    }
    if (isAssertion(e)) return true;
    // chai/Cypress fluent call form: result.should.equal(1) / cy.get(x).should(...).
    // isAssertion recognizes the `.should` property-access node, but on the spine the
    // enclosing CallExpression is what we see, so scan its callee chain for `.should`.
    // Only the property/call spine is walked, never `&&`/`?:` operands, so a
    // short-circuited assertion still does not count as guaranteed.
    if (ts.isCallExpression(e)) {
      let base: ts.Expression = e.expression;
      while (ts.isPropertyAccessExpression(base) || ts.isCallExpression(base)) {
        if (ts.isPropertyAccessExpression(base) && base.name.text === "should") return true;
        base = base.expression;
      }
    }
    return false;
  };

  const stmtGuaranteed = (st: ts.Statement): boolean => {
    if (ts.isExpressionStatement(st)) return directAssertion(st.expression);
    if (ts.isBlock(st)) return listGuaranteed(st.statements);
    if (ts.isLabeledStatement(st)) return stmtGuaranteed(st.statement);
    if (ts.isReturnStatement(st)) return st.expression !== undefined && directAssertion(st.expression);
    if (ts.isIfStatement(st)) {
      const t = litTruth(st.expression);
      if (t === true) return stmtGuaranteed(st.thenStatement);
      if (t === false) return st.elseStatement !== undefined && stmtGuaranteed(st.elseStatement);
      return false; // non-const condition: neither branch is guaranteed
    }
    if (ts.isTryStatement(st)) {
      // conservative: a try block on the spine counts as guaranteed (so
      // try{expect}finally{...} is not flagged); finally always runs; catch does not.
      if (listGuaranteed(st.tryBlock.statements)) return true;
      if (st.finallyBlock && listGuaranteed(st.finallyBlock.statements)) return true;
      return false;
    }
    // do/while is the one loop whose body always runs at least once, so an
    // assertion in it IS unconditional (the condition only controls repetition).
    if (ts.isDoStatement(st)) return stmtGuaranteed(st.statement);
    // for/while/for-of/for-in/switch/catch: their body is not guaranteed to run.
    return false;
  };

  const listGuaranteed = (stmts: readonly ts.Statement[]): boolean =>
    stmts.some(stmtGuaranteed);

  return listGuaranteed(body.statements);
}
