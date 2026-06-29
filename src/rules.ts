import ts from "typescript";
import { Finding, makeFinding } from "./types.js";
import { DIAGNOSTIC_THRESHOLDS } from "./cases.js";
import {
  ASSERT_ROOTS, ASSERT_METHODS, SNAPSHOT_MATCHERS, EQUALITY_MATCHERS,
  VUE_SVELTE_ASYNC, oracleKind,
} from "./oracles.js";
import { lineOf } from "./parse.js";
import { assertionsInDeadCode, hasUnconditionalAssertion } from "./cfg.js";
import { detectPyramidLevel } from "./level.js";

// --- test framework vocabulary (runner-agnostic) ---------------------------
// it/test/specify (Jest, Vitest, Mocha, Jasmine, AVA, node:test, Cypress,
// Playwright, tap). describe/context/suite are suites. fit/fdescribe focus and
// xit/xdescribe skip come from Jasmine/Mocha. The assertion-API vocabulary
// (ASSERT_ROOTS/ASSERT_METHODS/SNAPSHOT_MATCHERS/EQUALITY_MATCHERS and the async
// leaves) lives in the oracle registry (oracles.ts), imported above. JS5 routes
// its async detection through oracleKind() instead of a hand-rolled name list.
const TEST_BLOCK_ROOTS = new Set(["it", "test", "specify"]);
const SUITE_ROOTS = new Set(["describe", "context", "suite", "fdescribe", "xdescribe", "fcontext", "xcontext"]);
const FOCUS_NAMES = new Set(["fit", "fdescribe", "fcontext"]);

// Array-iterator methods whose callback runs once per element — zero times on an
// empty collection. An assertion that lives ONLY inside one of these callbacks
// (JS25) runs zero times when the receiver is empty: green with nothing checked.
const ARRAY_ITERATOR_METHODS = new Set(["forEach", "map", "filter", "some", "every", "flatMap"]);

// Equality matchers across runners for the literal-vs-literal (JS30) and
// self-confirming-literal (C11a) lanes: Jest/Vitest toBe family + toBeCloseTo,
// plus chai/AVA equal/equals/eql/is. Broader than EQUALITY_MATCHERS (which gates
// the Jest-only C5/C7/C8 lanes) on purpose.
const EQ_MATCHERS_ANY = new Set([
  "toBe", "toEqual", "toStrictEqual", "toBeCloseTo", "equal", "equals", "eql", "is",
]);

// toHaveBeenCalled* family (JS27): matchers that only assert a double was invoked.
const CALL_TRACKING_MATCHERS = new Set([
  "toHaveBeenCalled", "toHaveBeenCalledTimes", "toHaveBeenCalledWith",
  "toHaveBeenLastCalledWith", "toHaveBeenNthCalledWith", "toBeCalled",
  "toBeCalledTimes", "toBeCalledWith", "toHaveBeenCalledOnce",
]);
const SKIP_NAMES = new Set(["xit", "xdescribe", "xcontext", "xspecify"]);

// --- C48 dark-patch: a test that flips a known test-mode flag then asserts ---
// env keys (process.env.<KEY> = <test-mode value>) whose name means "we are under
// test". NODE_ENV only counts when set to "test" (production/development are real
// configs); CI is excluded (infra, not a product branch).
const ENV_TEST_MODE_KEYS = new Set([
  "NODE_ENV", "JEST_WORKER_ID", "VITEST", "TEST", "TESTING", "TEST_MODE",
  "TESTMODE", "UNDER_TEST", "IS_TEST",
]);
// module/settings flag names (settings.TESTING = true, config.TEST_MODE = true).
const MODULE_TEST_MODE_RE = /^(TESTING|TEST_MODE|IS_TEST|UNDER_TEST|_TESTING)$/;
const TEST_MODE_TRUE_STRINGS = new Set(["1", "true", "test", "yes", "on"]);

// --- name helpers ----------------------------------------------------------
function calleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const base = calleeName(expr.expression);
    return base ? base + "." + expr.name.text : expr.name.text;
  }
  if (ts.isCallExpression(expr)) return calleeName(expr.expression);
  if (ts.isParenthesizedExpression(expr)) return calleeName(expr.expression);
  return "";
}

/** Leftmost identifier of a property/call/element chain: `a.b().c` -> "a". */
function rootIdent(e: ts.Expression | undefined): string | null {
  let cur: ts.Expression | undefined = e;
  while (cur) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur) || ts.isElementAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    } else {
      return null;
    }
  }
  return null;
}

/** True if the expression chain bottoms out in an `expect(...)` call, walking
 *  through property access, calls, `.not`/`.resolves`/`.rejects`, and wrappers. */
function expectRooted(e: ts.Expression | undefined): boolean {
  let cur: ts.Expression | undefined = e;
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === "expect") {
      return true;
    }
    if (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur) || ts.isElementAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    } else {
      return false;
    }
  }
  return false;
}

// --- JS24: Cypress query chain with no terminating assertion ---------------
const CY_QUERY_COMMANDS = new Set(["get", "find", "contains"]);

/** True if any `expect(...)` call appears under `scope` (any matcher form, or a
 *  bare expect). Used to keep a cy chain clean when it asserts inside a .then. */
function containsExpectCall(scope: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && expectRooted(n)) { found = true; return; }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return found;
}

/** True if a call chain rooted at `cy` ends in a query command (get/find/contains)
 *  and carries no terminating `.should`/`.and` and no `expect(...)` inside a `.then`
 *  callback — so it produces a subject that is never asserted. Action commands
 *  (click/type/visit/...) as the outermost call do something, so they stay clean.
 *  `expr` is the outermost call of the statement. */
function isUnassertedCyQuery(expr: ts.CallExpression): boolean {
  if (rootIdent(expr) !== "cy") return false;
  // outermost command must be a query, not an action (action does work, not just query)
  if (!ts.isPropertyAccessExpression(expr.expression)) return false;
  if (!CY_QUERY_COMMANDS.has(expr.expression.name.text)) return false;
  // scan the whole chain for a terminating assertion: any .should/.and, or an
  // expect(...) inside a .then(cb) callback. Either keeps it clean.
  let cur: ts.Node = expr;
  const visit = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      if (m === "should" || m === "and") return true;
      if (m === "then") {
        const cb = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (cb && containsExpectCall(cb)) return true;
      }
    }
    let asserted = false;
    ts.forEachChild(n, (c) => { if (visit(c)) asserted = true; });
    return asserted;
  };
  return !visit(cur);
}

function literalTruthiness(e: ts.Expression | undefined): boolean | null {
  if (!e) return null;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(e) && e.text === "undefined") return false;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isStringLiteral(e)) return e.text.length > 0;
  return null;
}

function isLiteral(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  return (
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e)
  );
}

/** A value turned into text: String(x), JSON.stringify(x), x.toString(), `${x}`. */
function isStringify(e?: ts.Expression): boolean {
  if (!e) return false;
  if (ts.isTemplateExpression(e)) return true;
  if (ts.isCallExpression(e)) {
    const n = calleeName(e.expression);
    const leaf = n.split(".").pop() ?? "";
    return leaf === "String" || n === "JSON.stringify" || leaf === "toString" || leaf === "toJSON";
  }
  return false;
}

function containsCall(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) { found = true; return; }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

interface ExpectChain {
  subject: ts.Expression | undefined;
  matcher: string;
  args: readonly ts.Expression[];
  negated: boolean;
}

/** Decode `expect(subject)[.not][.resolves].matcher(args)` from a CallExpression. */
function expectChain(call: ts.CallExpression): ExpectChain | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const matcher = call.expression.name.text;
  let base: ts.Expression = call.expression.expression;
  let negated = false;
  while (ts.isPropertyAccessExpression(base)) {
    if (base.name.text === "not") negated = true;
    base = base.expression;
  }
  if (
    ts.isCallExpression(base) &&
    ts.isIdentifier(base.expression) &&
    base.expression.text === "expect"
  ) {
    return { subject: base.arguments[0], matcher, args: call.arguments, negated };
  }
  return null;
}

/** True if `call` is the terminal matcher call of an `expect(...).resolves`/
 *  `.rejects` chain (e.g. `expect(p).resolves.toBe(1)`). Walks the callee base for a
 *  `.resolves`/`.rejects` property access that bottoms out in an `expect(...)` call.
 *  Only the explicit resolves/rejects marker counts (JS29); a plain promise does not. */
function expectIsResolvesRejects(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  let base: ts.Expression = call.expression.expression;
  let sawSettle = false;
  while (ts.isPropertyAccessExpression(base) || ts.isCallExpression(base)) {
    if (ts.isPropertyAccessExpression(base) &&
        (base.name.text === "resolves" || base.name.text === "rejects")) sawSettle = true;
    base = base.expression;
  }
  return sawSettle && expectRooted(call.expression);
}

/** True if a call's result is observed: awaited, returned, assigned, the
 *  implicit-return body of an arrow, or explicitly discarded with `void` (an
 *  author signalling "I am dropping this on purpose"). A bare floating call (its
 *  enclosing statement is a plain ExpressionStatement) is NOT observed. Used to
 *  gate supertest `.expect()` so a floating API request still surfaces as C2b,
 *  and JS5 so a dropped async query/event still surfaces. */
function isObservedAsync(node: ts.Node): boolean {
  let cur: ts.Node = node;
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isAwaitExpression(p) || ts.isReturnStatement(p)) return true;
    if (ts.isVariableDeclaration(p)) return true;
    // A BinaryExpression only observes the call when it is a real assignment
    // (`=` or a compound `+=` etc., kinds in FirstAssignment..LastAssignment) and
    // the call is the right-hand side. A logical/comparison/arithmetic operator
    // (`||`, `&&`, `===`, `+`, ...) does NOT observe it: `findBy*() || expect(...)`
    // still floats the promise and must surface as JS5.
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      const isAssign = k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
      if (isAssign && p.right === cur) return true;
    }
    if (ts.isVoidExpression(p)) return true; // `void expr` — discarded on purpose
    if (ts.isArrowFunction(p) && p.body === cur) return true;
    if (ts.isExpressionStatement(p)) return false;
    cur = p;
    p = p.parent;
  }
  return false;
}

// --- assertion presence ----------------------------------------------------
function isAssertionNode(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const parts = name.split(".");
    const root = parts[0];
    const leaf = parts[parts.length - 1];
    // expect(x).matcher(...) — Jest, Vitest, Jasmine, Playwright, jest-dom, chai expect
    if (root === "expect" && ts.isPropertyAccessExpression(node.expression)) return true;
    // <chain>.expect(...) — supertest / chai-http API tests: request(app).get("/").expect(200)
    // is the assertion (it throws on mismatch), but only when the request is awaited or
    // returned. A floating `request(app).get("/").expect(200);` can finish after the test
    // ends, so it stays uncovered (C2b) instead of scanning clean.
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "expect"
        && isObservedAsync(node)) return true;
    if (root === "assert") return true;            // node:test, chai assert
    if (root === "sinon" && name.includes("assert")) return true;
    // AVA (t.is), node:test/tap (t.ok), Cypress (cy....should), QUnit
    if (ASSERT_ROOTS.has(root) && ASSERT_METHODS.has(leaf)) return true;
    if (leaf === "should") return true;            // x.should() (chai/Cypress as a call)
    // custom assertion helpers by naming convention: util.assertEqual(...),
    // assertType(...), expectType(...), checkX(...). Bare expect() is excluded
    // (that is JS2). Recognizing these avoids C2b false positives in projects
    // that extract assertions into helpers.
    if (leaf.startsWith("assert")) return true;
    if (leaf.startsWith("expect") && leaf !== "expect") return true;
  }
  // chai/Cypress fluent: x.should.equal / cy.get().should — the `.should` access
  if (ts.isPropertyAccessExpression(node) && node.name.text === "should") return true;
  return false;
}

function hasAssertion(scope: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (isAssertionNode(n)) { found = true; return; }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(scope, walk);
  return found;
}

/** Like hasAssertion but tests the node itself too (for branch/try-block subtrees). */
function containsAssertion(node: ts.Node): boolean {
  return isAssertionNode(node) || hasAssertion(node);
}

/** Visit descendants of `node` without entering nested function scopes (a helper
 *  def/arrow/method in the test body is its own scope, not the test's). */
function forEachNoNesting(node: ts.Node, visit: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    visit(child);
    if (!ts.isFunctionLike(child)) forEachNoNesting(child, visit);
  });
}

/** The env key of a `process.env.KEY = ...` / `process.env["KEY"] = ...` target, else null. */
function envAssignKey(lhs: ts.Expression): string | null {
  const isProcessEnv = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) && e.name.text === "env" &&
    ts.isIdentifier(e.expression) && e.expression.text === "process";
  if (ts.isPropertyAccessExpression(lhs) && isProcessEnv(lhs.expression)) return lhs.name.text;
  if (ts.isElementAccessExpression(lhs) && isProcessEnv(lhs.expression) &&
      ts.isStringLiteralLike(lhs.argumentExpression)) return lhs.argumentExpression.text;
  return null;
}

/** A value that puts a test-mode flag into test mode. NODE_ENV only counts as "test";
 *  every other key takes true/1/"1"/"true"/"test"/"yes"/"on". */
function isTestModeValue(rhs: ts.Expression, key: string): boolean {
  if (key === "NODE_ENV") return ts.isStringLiteralLike(rhs) && rhs.text === "test";
  if (rhs.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(rhs)) return rhs.text === "1";
  if (ts.isStringLiteralLike(rhs)) return TEST_MODE_TRUE_STRINGS.has(rhs.text.trim().toLowerCase());
  return false;
}

/** True if `bin` is a raw write that flips a known test-mode toggle into test mode:
 *  process.env.<KEY> = <test value>, or <obj>.TESTING = <truthy> (obj not `this`). */
function isTestModeToggleWrite(bin: ts.BinaryExpression): boolean {
  if (bin.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const lhs = bin.left;
  const envKey = envAssignKey(lhs);
  if (envKey && ENV_TEST_MODE_KEYS.has(envKey) && isTestModeValue(bin.right, envKey)) return true;
  if (ts.isPropertyAccessExpression(lhs) && MODULE_TEST_MODE_RE.test(lhs.name.text) &&
      lhs.expression.kind !== ts.SyntaxKind.ThisKeyword &&
      isTestModeValue(bin.right, lhs.name.text)) return true;
  return false;
}

/** True if a catch block does nothing meaningful: empty, or only console.* /
 *  comments, with no throw, no assertion, and no fail() — so it swallows errors. */
function isHarmlessCatch(block: ts.Block): boolean {
  for (const stmt of block.statements) {
    if (ts.isThrowStatement(stmt)) return false;
    if (containsAssertion(stmt)) return false;
    if (ts.isExpressionStatement(stmt)) {
      const name = calleeName(
        ts.isCallExpression(stmt.expression) ? stmt.expression.expression : stmt.expression,
      );
      const leaf = name.split(".").pop() ?? "";
      if (name.startsWith("console.")) continue;
      if (leaf === "fail") return false;
      continue; // other no-op-ish expression: still swallows
    }
    // any other statement (return/log/etc.) still does not re-raise
  }
  return true;
}

/** Stricter than isHarmlessCatch, for JS31: the catch truly swallows the throw,
 *  doing NOTHING with it. Only an empty body or `console.*` log-only statements
 *  qualify. An assignment (recovery flag like `supported = false`), a return, a
 *  fail()/throw, an assertion, or any other call is meaningful handling, not a
 *  silent swallow, so JS31 must not fire. Keeps JS31 precision-first. */
function catchSilentlySwallows(block: ts.Block): boolean {
  for (const stmt of block.statements) {
    if (!ts.isExpressionStatement(stmt)) return false; // return/var/if/etc: handling
    if (!ts.isCallExpression(stmt.expression)) return false; // a bare assignment/expr
    if (!calleeName(stmt.expression.expression).startsWith("console.")) return false;
  }
  return true;
}

/** Matcher names of every expect-chain assertion under scope (for snapshot-only). */
function matchersUnder(scope: ts.Node): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const chain = expectChain(n);
      if (chain) out.push(chain.matcher);
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(scope, walk);
  return out;
}

/** True if any snapshot matcher under `scope` is an inline snapshot with no
 *  baseline yet: `toMatchInlineSnapshot()` / `toThrowErrorMatchingInlineSnapshot()`
 *  with no argument, or an empty/whitespace-only string-literal baseline. On the
 *  first run the runner writes the snapshot from the output itself, so it passes
 *  by construction. A populated inline snapshot has a real baseline and is not this. */
function hasEmptyInlineSnapshot(scope: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const chain = expectChain(n);
      if (chain && (chain.matcher === "toMatchInlineSnapshot" ||
                    chain.matcher === "toThrowErrorMatchingInlineSnapshot")) {
        const a0 = chain.args[0];
        if (a0 === undefined) { found = true; return; }
        if ((ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) &&
            a0.text.trim() === "") { found = true; return; }
      }
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(scope, walk);
  return found;
}

/** The numeric N of an `expect.assertions(N)` call (N a numeric literal), else
 *  null. `expect.hasAssertions()` carries no count and is not this. */
function expectAssertionsCount(call: ts.CallExpression): number | null {
  if (calleeName(call.expression) !== "expect.assertions") return null;
  const a0 = call.arguments[0];
  if (a0 && ts.isNumericLiteral(a0)) return Number(a0.text);
  return null;
}

/** JS23 expect accounting. `unconditional` is the count of expect-chain matcher
 *  calls guaranteed to run: a direct ExpressionStatement on the test body's spine
 *  (optionally awaited). `indeterminate` is true when any other expect-chain call
 *  exists in the body (in a loop, branch, try, switch, callback, .then, or an
 *  expression operand) — its run count cannot be proven, so a shortfall is not
 *  provable and JS23 must be suppressed (FP-averse: a false positive is worse than
 *  a miss). Stops at nested functions only for the spine count, but the
 *  indeterminate scan walks the whole body (a .then callback IS indeterminate). */
function expectAccounting(body: ts.Block): { unconditional: number; indeterminate: boolean } {
  const spine = new Set<ts.Node>();
  let unconditional = 0;
  for (const st of body.statements) {
    if (!ts.isExpressionStatement(st)) continue;
    let e: ts.Expression = st.expression;
    if (ts.isAwaitExpression(e)) e = e.expression;
    if (ts.isCallExpression(e) && expectChain(e)) { unconditional++; spine.add(e); }
  }
  // Anything that is not the proven-unconditional expect spine makes the count
  // indeterminate: an off-spine expect chain (loop/branch/.then/operand), or any
  // other call — a helper or setup call may carry assertions the count cannot see.
  // Do not descend into a spine chain (its inner expect()/matcher calls are
  // accounted, not separate helpers).
  let indeterminate = false;
  const walk = (n: ts.Node): void => {
    if (indeterminate) return;
    if (spine.has(n)) return; // whole spine chain already counted
    if (ts.isCallExpression(n)) {
      const nm = calleeName(n.expression);
      if (nm !== "expect.assertions" && nm !== "expect.hasAssertions") { indeterminate = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  walk(body);
  return { unconditional, indeterminate };
}

/** JS8 (spyOn form): collect `{root -> line}` for every jest.spyOn/vi.spyOn target
 *  whose return was canned (mockReturnValue/mockResolvedValue/mockRejectedValue/
 *  mockImplementation) under `scope`. Test-local on purpose: a spyOn is hoisted only
 *  within its own test body, unlike the module-wide jest.mock form. */
function cannedSpyTargets(scope: ts.Node): Map<string, number> {
  const out = new Map<string, number>();
  const sf = scope.getSourceFile();
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) &&
        /^(mockReturnValue|mockResolvedValue|mockRejectedValue|mockImplementation)$/.test(
          calleeName(n.expression).split(".").pop() ?? "")) {
      let base: ts.Expression = n.expression;
      while (ts.isPropertyAccessExpression(base) || ts.isCallExpression(base)) {
        if (ts.isCallExpression(base)) {
          const cn = calleeName(base.expression);
          if (cn === "jest.spyOn" || cn === "vi.spyOn") {
            const tr = base.arguments[0] && rootIdent(base.arguments[0]);
            if (tr) out.set(tr, lineOf(sf, n));
            break;
          }
        }
        base = ts.isCallExpression(base) ? base.expression
          : (base as ts.PropertyAccessExpression).expression;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return out;
}

/** Root identifiers used as an expect subject under `scope` (`expect(a.b).m()` -> "a"). */
function expectSubjectRoots(scope: ts.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const chain = expectChain(n);
      if (chain && chain.subject) {
        const r = rootIdent(chain.subject);
        if (r) out.add(r);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return out;
}

/** JS25: every assertion under `scope` sits inside an array-iterator callback
 *  (arr.forEach/map/filter/some/every/flatMap(cb)), and at least one such
 *  assertion exists. Walk the body; when entering an iterator callback, any
 *  assertion inside counts as "iterator-bound"; an assertion reached outside one
 *  is an own-scope assertion that disproves JS25. Returns whether the only
 *  assertions are iterator-bound (and there is at least one). FP-averse: a single
 *  own-scope assertion anywhere suppresses it. */
function assertionsOnlyInArrayIterator(scope: ts.Node): boolean {
  let iteratorBound = 0;
  let ownScope = 0;
  // The callback nodes of array-iterator calls under scope, so the walk knows when
  // an assertion is inside one without re-deriving the call shape per node.
  const iterCallbacks = new Set<ts.Node>();
  const collect = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ARRAY_ITERATOR_METHODS.has(n.expression.name.text)) {
      for (const a of n.arguments) {
        if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) iterCallbacks.add(a);
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(scope);

  const walk = (n: ts.Node, insideIter: boolean): void => {
    const nowInside = insideIter || iterCallbacks.has(n);
    if (isAssertionNode(n)) {
      if (nowInside) iteratorBound++; else ownScope++;
    }
    ts.forEachChild(n, (c) => walk(c, nowInside));
  };
  ts.forEachChild(scope, (c) => walk(c, false));
  return ownScope === 0 && iteratorBound > 0;
}

/** True if `scope` carries an expect.assertions(N) / expect.hasAssertions() guard
 *  (JS23 territory) — used as a JS25 FP guard: the author already declared a count. */
function hasAssertionCountGuard(scope: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const nm = calleeName(n.expression);
      if (nm === "expect.assertions" || nm === "expect.hasAssertions") { found = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return found;
}

/** True if any array-iterator call under `scope` iterates a non-empty array
 *  literal receiver (arr `[1, 2].forEach(...)`) — JS25 FP guard: a non-empty
 *  literal always runs the callback at least once, so the assertion does run. */
function iteratesNonEmptyArrayLiteral(scope: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ARRAY_ITERATOR_METHODS.has(n.expression.name.text)) {
      const recv = n.expression.expression;
      if (ts.isArrayLiteralExpression(recv) && recv.elements.length > 0) { found = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return found;
}

/** JS27: the matcher names of every expect-chain assertion under `scope`, each
 *  paired with the root identifier of its subject. Used to decide whether the ONLY
 *  oracle is a toHaveBeenCalled* check on a locally-created double. */
function expectMatcherSubjects(scope: ts.Node): { matcher: string; root: string | null }[] {
  const out: { matcher: string; root: string | null }[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const chain = expectChain(n);
      if (chain) out.push({ matcher: chain.matcher, root: chain.subject ? rootIdent(chain.subject) : null });
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return out;
}

/** Root identifiers in `scope` bound to a freshly-created test double:
 *  jest.fn()/vi.fn()/jest.spyOn()/vi.spyOn() in a const/let, or a mockReturnValue/
 *  mockImplementation-decorated handle. Used by JS27 to confirm the call-tracking
 *  subject is a local double, not a real collaborator. */
function localDoubleRoots(scope: ts.Node): Set<string> {
  const out = new Set<string>();
  const isDoubleInit = (e: ts.Expression): boolean => {
    let cur: ts.Expression = e;
    while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) {
      if (ts.isCallExpression(cur)) {
        const nm = calleeName(cur.expression);
        if (nm === "jest.fn" || nm === "vi.fn" || nm === "jest.spyOn" || nm === "vi.spyOn" ||
            nm === "sinon.spy" || nm === "sinon.stub") return true;
      }
      cur = ts.isCallExpression(cur) ? cur.expression : cur.expression;
    }
    return false;
  };
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) &&
        isDoubleInit(n.initializer)) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return out;
}

/** JS26: a fake-timer install and a setTimeout/setInterval arm both live under
 *  `scope`, but no flush/advance does (in scope or a sibling lifecycle hook). The
 *  scheduled callback never fires, so any assertion runs against un-mutated state. */
function timerInstalledNeverAdvanced(scope: ts.Node, timer: ts.CallExpression, sf: ts.SourceFile): boolean {
  // install present in scope, no flush in scope — order does not matter (a frozen
  // timer that is never advanced is vacuous regardless of where the install sits).
  if (!callMatchesUnder(scope, sf, FAKE_TIMER_INSTALL)) return false;
  if (callMatchesUnder(scope, sf, FAKE_TIMER_FLUSH)) return false;
  // a sibling hook may install or flush; reuse the JS-wide hook scan. If a hook
  // flushes, the callback fires, so suppress.
  if (hookControlsTimerFlush(timer, sf)) return false;
  return true;
}

/** True if an enclosing describe/top-level afterEach/afterAll flushes timers — the
 *  JS26 suppression twin of hookControlsTimer (which also accepts a before-install).
 *  Here only a teardown flush matters: an install in a hook does not advance. */
function hookControlsTimerFlush(timer: ts.CallExpression, sf: ts.SourceFile): boolean {
  const scan = (statements: readonly ts.Statement[]): boolean => {
    for (const stmt of statements) {
      if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
      const hook = calleeName(stmt.expression.expression).split(".")[0];
      const cb = getTestCallback(stmt.expression);
      if (!cb) continue;
      if (callMatchesUnder(cb, sf, FAKE_TIMER_FLUSH) &&
          (SETUP_HOOKS.has(hook) || TEARDOWN_HOOKS.has(hook))) return true;
    }
    return false;
  };
  if (scan(sf.statements)) return true;
  let pn: ts.Node | undefined = timer.parent;
  while (pn) {
    if ((ts.isArrowFunction(pn) || ts.isFunctionExpression(pn) || ts.isFunctionDeclaration(pn)) &&
        pn.parent && ts.isCallExpression(pn.parent) && pn.parent.arguments.includes(pn as ts.Expression)) {
      const suiteRoot = calleeName(pn.parent.expression).split(".")[0];
      if (SUITE_ROOTS.has(suiteRoot) && pn.body && ts.isBlock(pn.body) && scan(pn.body.statements)) return true;
    }
    pn = pn.parent;
  }
  return false;
}

function getTestCallback(call: ts.CallExpression): ts.FunctionLikeDeclaration | null {
  for (const arg of call.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  }
  return null;
}

/** The function body that encloses `node` for timer-flush scoping: the nearest
 *  ancestor arrow/function that is the callback of an it/test/specify call (so a
 *  flush in one test never reaches a timer in another), falling back to the
 *  nearest enclosing function, then the whole source file. */
function enclosingTestScope(node: ts.Node): ts.Node {
  let fallback: ts.Node | null = null;
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p)) {
      if (!fallback) fallback = p;
      const call = p.parent;
      if (call && ts.isCallExpression(call) && call.arguments.includes(p as ts.Expression)) {
        const root = calleeName(call.expression).split(".")[0];
        if (TEST_BLOCK_ROOTS.has(root) || root === "fit" || root === "xit") return p;
      }
    }
    p = p.parent;
  }
  return fallback ?? node.getSourceFile();
}

const FAKE_TIMER_INSTALL = /\b(useFakeTimers|installFakeTimers)\b/;
const FAKE_TIMER_FLUSH = /\b(runAllTimers|runOnlyPendingTimers|advanceTimersByTime|tick)\b/;

const SETUP_HOOKS = new Set(["beforeEach", "beforeAll"]);
const TEARDOWN_HOOKS = new Set(["afterEach", "afterAll"]);

/** True if any call under `scope` matches `re`. */
function callMatchesUnder(scope: ts.Node, sf: ts.SourceFile, re: RegExp): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && re.test(calleeName(n.expression))) { found = true; return; }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  return found;
}

/** Scan one statement list for a lifecycle hook that drives the timer: a
 *  fake-timer install in a beforeEach/beforeAll runs before every test in scope,
 *  a flush/advance in an afterEach/afterAll runs after. Order inside the hook does
 *  not matter — the runner sequences the hook around the test body. */
function hookStatementsControlTimer(
  statements: readonly ts.Statement[],
  sf: ts.SourceFile,
): boolean {
  for (const stmt of statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
    const hook = calleeName(stmt.expression.expression).split(".")[0];
    const cb = getTestCallback(stmt.expression);
    if (!cb) continue;
    if (SETUP_HOOKS.has(hook) && callMatchesUnder(cb, sf, FAKE_TIMER_INSTALL)) return true;
    if (TEARDOWN_HOOKS.has(hook) && callMatchesUnder(cb, sf, FAKE_TIMER_FLUSH)) return true;
  }
  return false;
}

/** A timer can be driven from a sibling lifecycle hook rather than the test body.
 *  Top-level hooks (outside any describe) wrap every test in the file, and hooks
 *  in any enclosing describe/suite wrap every test nested under it. Check both. */
function hookControlsTimer(timer: ts.CallExpression, sf: ts.SourceFile): boolean {
  // Top-level hooks live directly in the source file and apply to every test.
  if (hookStatementsControlTimer(sf.statements, sf)) return true;
  let p: ts.Node | undefined = timer.parent;
  while (p) {
    // The body of an enclosing describe/suite callback: scan its top-level hook calls.
    if (
      (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p)) &&
      p.parent && ts.isCallExpression(p.parent) &&
      p.parent.arguments.includes(p as ts.Expression)
    ) {
      const suiteRoot = calleeName(p.parent.expression).split(".")[0];
      if (SUITE_ROOTS.has(suiteRoot) && p.body && ts.isBlock(p.body)) {
        if (hookStatementsControlTimer(p.body.statements, sf)) return true;
      }
    }
    p = p.parent;
  }
  return false;
}

/** Precise replacement for the old file-wide fake-timer suppression. A
 *  setTimeout/setInterval is "controlled" when, inside the same enclosing test
 *  callback, either a fake-timer install runs BEFORE it or a flush/advance call
 *  runs AFTER it; OR when an enclosing describe drives the timer through a sibling
 *  hook (install in beforeEach/beforeAll, flush in afterEach/afterAll). A flush
 *  before the arm (callback never ran) or a flush in a different test does not
 *  count. */
function timerIsControlled(timer: ts.CallExpression, sf: ts.SourceFile): boolean {
  const scope = enclosingTestScope(timer);
  const armPos = timer.getStart(sf);
  let controlled = false;
  const walk = (n: ts.Node): void => {
    if (controlled) return;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      const pos = n.getStart(sf);
      if (FAKE_TIMER_INSTALL.test(name) && pos < armPos) { controlled = true; return; }
      if (FAKE_TIMER_FLUSH.test(name) && pos > armPos) { controlled = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  walk(scope);
  if (controlled) return true;
  return hookControlsTimer(timer, sf);
}

// --- C16: nondeterminism ----------------------------------------------------
function c16Detail(call: ts.CallExpression): string | null {
  const name = calleeName(call.expression);
  const leaf = name.split(".").pop() ?? "";
  if (name === "Math.random") return "Math.random() without a fixed seed";
  if (name === "Date.now" || name === "performance.now") return "reads the system clock";
  // crypto.randomUUID() / crypto.getRandomValues() (incl. globalThis/window/self.crypto and
  // the bare node:crypto import) produce a fresh random value each run with no seed. Anchored
  // to a crypto root so a user method named randomUUID()/getRandomValues() is NOT flagged.
  const isCryptoRandom = (m: string): boolean =>
    name === "crypto." + m || name.endsWith(".crypto." + m) || name === m;
  if (isCryptoRandom("randomUUID") || isCryptoRandom("getRandomValues")) {
    return "crypto randomness without a seed";
  }
  if (name === "setTimeout" || name === "setInterval") {
    if (call.arguments.length >= 2 && ts.isNumericLiteral(call.arguments[1])) {
      return "fixed timer delay";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main: collect findings from a parsed source file.
// ---------------------------------------------------------------------------
export function analyze(sf: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const file = sf.fileName;
  const text = sf.getFullText();
  const level = detectPyramidLevel(sf);
  // Fake-timer / flush presence suppresses the JS7 timer arm: if the test fakes
  // or drives timers anywhere, a setTimeout/setInterval callback is flushed
  // synchronously and its assertion does run. Covers Jest, Vitest and Sinon
  // install calls plus the explicit advance/run calls (jest/vi runAllTimers,
  // runOnlyPendingTimers, advanceTimersByTime, sinon clock.tick).
  const fakeTimers = /\b(useFakeTimers|installFakeTimers|runAllTimers|runOnlyPendingTimers|advanceTimersByTime|tick)\b/.test(text);

  const push = (line: number, code: string, detail = ""): void => {
    findings.push(makeFinding(file, line, code, detail));
  };

  // JS8 (self-mock) file-level state
  const mockedAt = new Map<string, number>();      // module -> line of jest.mock/vi.mock
  const importBinding = new Map<string, string>(); // binding name -> module
  const expectRoots = new Set<string>();           // root identifier used as expect subject

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) importBinding.set(clause.name.text, mod);
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) importBinding.set(nb.name.text, mod);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) importBinding.set(el.name.text, mod);
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const root = name.split(".")[0];
      if ((name === "jest.mock" || name === "vi.mock" || name === "jest.doMock" || name === "vi.doMock") &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        mockedAt.set(node.arguments[0].text, lineOf(sf, node));
      }
      const modifier = name.split(".")[1] ?? "";

      // JS1 focused / JS4 skipped
      if (
        name.endsWith(".only") ||
        FOCUS_NAMES.has(root) ||
        (FOCUS_NAMES.has(name))
      ) {
        push(lineOf(sf, node), "JS1", `focused via ${name}`);
      } else if (
        name.endsWith(".skip") ||
        name.endsWith(".todo") ||
        SKIP_NAMES.has(root)
      ) {
        push(lineOf(sf, node), "JS4", `skipped via ${name}`);
      }

      // test-level block body checks (C2, C2b, JS3). Only `it`/`test`/`specify`
      // (and the focus/skip variants) — never `describe`/`suite`, whose body holds
      // nested tests, not assertions.
      const isTestBlock =
        TEST_BLOCK_ROOTS.has(root) || root === "fit" || root === "xit";
      if (isTestBlock) {
        const cb = getTestCallback(node);
        // JS18: the test takes a `done` callback instead of async/await. A done
        // called too early, or inside a floating promise, lets the test pass
        // before the assertions run.
        if (cb && cb.parameters.length > 0) {
          const p0 = cb.parameters[0].name;
          if (ts.isIdentifier(p0) && p0.text === "done") {
            push(lineOf(sf, node), "JS18", "uses a done callback; prefer async/await");
          }
        }
        if (cb && cb.body && ts.isBlock(cb.body)) {
          const stmts = cb.body.statements;
          const line = lineOf(sf, node);
          // C20: an assertion at a position control can never reach (after a
          // return/throw/process.exit/break, both-arms-terminating if, exhaustive
          // switch). Structured reachability over the whole body, not just the top
          // level; stops at nested functions (their returns are their own).
          const deadAsserts = assertionsInDeadCode(cb.body, isAssertionNode);
          for (const a of deadAsserts) {
            push(lineOf(sf, a), "C20", "assertion in unreachable code (after a return/throw/exit) never runs");
          }
          const deadAssertSet = new Set<ts.Node>(deadAsserts);
          // C48: dark patch — the test flips a known test-mode flag (process.env or a
          // module/settings flag) into test mode and then asserts, exercising the
          // product's test-only branch instead of real behaviour. v1: raw writes only.
          const toggles: { pos: number; line: number }[] = [];
          const assertPositions: number[] = [];
          forEachNoNesting(cb.body, (n) => {
            if (ts.isBinaryExpression(n) && isTestModeToggleWrite(n)) {
              toggles.push({ pos: n.getStart(sf), line: lineOf(sf, n) });
            }
            if (isAssertionNode(n)) assertPositions.push(n.getStart(sf));
          });
          for (const w of toggles) {
            if (assertPositions.some((ap) => ap > w.pos)) {
              push(w.line, "C48", "test sets a test-mode flag then asserts — drive real behaviour, not the test-only branch");
            }
          }

          if (stmts.length === 0) {
            push(line, "C2", "test body is empty");
          } else if (!hasAssertion(cb) && containsCall(cb.body)) {
            push(line, "C2b", "calls code but never asserts");
          } else if (hasAssertion(cb)) {
            const ms = matchersUnder(cb);
            if (ms.length > 0 && ms.every((m) => SNAPSHOT_MATCHERS.has(m))) {
              push(line, "JS3", hasEmptyInlineSnapshot(cb)
                ? "the only assertion is an empty inline snapshot — it passes by writing itself on first run"
                : "the only assertion is a snapshot");
            }
            // C21: the test has at least one assertion in its own scope and none of
            // them is guaranteed to run unconditionally (all behind a condition, a
            // loop, a switch, or a catch). Assertions that live only inside a nested
            // callback are not counted here (unmodeled execution → suppress, FP-averse).
            // Assertions already flagged C20 (dead code) are excluded: C20 owns them, so
            // a dead-code-only test reports C20 alone, not a contradictory C20 + C21 (#62).
            const ownAsserts: ts.Node[] = [];
            forEachNoNesting(cb.body, (n) => {
              if (isAssertionNode(n) && !deadAssertSet.has(n)) ownAsserts.push(n);
            });
            if (ownAsserts.length > 0 &&
                !hasUnconditionalAssertion(cb.body, isAssertionNode, literalTruthiness, deadAssertSet)) {
              push(line, "C21", "every assertion is guarded by a condition");
            }
          }

          // JS23: expect.assertions(N) with N a numeric literal, but fewer
          // unconditional reachable non-nested expect() matcher calls than N — the
          // guard can never be satisfied. FP-averse: any expect in a loop, branch,
          // callback, or helper is indeterminate, so the count is undercounted and a
          // shortfall is only reported when it is provable. expect.hasAssertions()
          // carries no count and is skipped. Distinct from the deliberately-skipped JS16.
          let assertionsGuard: { line: number; n: number } | null = null;
          forEachNoNesting(cb.body, (n) => {
            if (ts.isCallExpression(n)) {
              const cnt = expectAssertionsCount(n);
              if (cnt !== null) assertionsGuard = { line: lineOf(sf, n), n: cnt };
            }
          });
          if (assertionsGuard !== null) {
            const guard = assertionsGuard as { line: number; n: number };
            const acc = expectAccounting(cb.body);
            if (!acc.indeterminate && acc.unconditional < guard.n) {
              push(guard.line, "JS23",
                `expect.assertions(${guard.n}) but only ${acc.unconditional} unconditional expect() call(s) run`);
            }
          }

          // JS8 (spyOn form): test-local. A spyOn target with a canned return that is
          // also an expect subject IN THE SAME test body is a self-mock — the test
          // asserts the canned value. Scoped to cb.body so a spy in one test never
          // matches an assertion in another (the jest.mock module form, hoisted
          // file-wide, is handled separately after the walk).
          const spied = cannedSpyTargets(cb.body);
          if (spied.size > 0) {
            const subjects = expectSubjectRoots(cb.body);
            for (const [tr, ln] of spied) {
              if (subjects.has(tr)) {
                push(ln, "JS8", `${tr} is spied with a canned return and asserted directly`);
                break;
              }
            }
          }

          // JS25: every assertion lives inside an array-iterator callback
          // (forEach/map/filter/some/every/flatMap) and none on the test's own
          // spine — so on an empty collection the callback never runs and zero
          // assertions execute. The verified hole between C2/C2b (hasAssertion
          // descends into callbacks, so it finds one) and C21 (its ownAsserts stop
          // at callbacks, so it sees none). FP guards: any own-scope assertion, a
          // non-empty array-literal receiver, or an expect.assertions/hasAssertions
          // guard suppress it.
          if (hasAssertion(cb) && assertionsOnlyInArrayIterator(cb.body) &&
              !iteratesNonEmptyArrayLiteral(cb.body) && !hasAssertionCountGuard(cb.body)) {
            push(line, "JS25", "the only assertion is inside an array-iterator callback; it runs zero times on an empty collection");
          }

          // JS27: every expect-chain matcher is in the toHaveBeenCalled* family AND
          // each such subject root is a locally-created double (jest.fn/vi.fn/spyOn).
          // The test confirms it called the double it set up, never the unit's output
          // or state (J3). FP guards: any non-call-tracking assertion suppresses it,
          // and it is gated to the unit level (a logger-spy call check is legit at
          // integration/e2e). Sibling of JS8.
          if (level === "unit") {
            const ms27 = expectMatcherSubjects(cb.body);
            if (ms27.length > 0 && ms27.every((m) => CALL_TRACKING_MATCHERS.has(m.matcher))) {
              const doubles = localDoubleRoots(cb.body);
              if (ms27.every((m) => m.root !== null && doubles.has(m.root))) {
                push(line, "JS27", "the only oracle is a toHaveBeenCalled* check on a local double; assert the unit's output or state");
              }
            }
          }

          // C11a: self-confirming literal — the expected value is bound from the
          // same call/expression under test. `const e = foo(); expect(foo()).toBe(e)`
          // can never fail: both sides evaluate the SUT, so the oracle confirms the
          // code against itself (J2). Static, low-FP corner of the circular-oracle
          // family. FP guard: the bound initializer must be provably the SUT call,
          // i.e. its source text equals the expect subject's source text exactly, and
          // it contains a call (a plain literal binding is not self-confirming).
          {
            const inits = new Map<string, string>(); // var name -> initializer text
            forEachNoNesting(cb.body, (n) => {
              if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
                  containsCall(n.initializer)) {
                inits.set(n.name.text, n.initializer.getText(sf).replace(/\s+/g, " ").trim());
              }
            });
            if (inits.size > 0) {
              forEachNoNesting(cb.body, (n) => {
                if (!ts.isCallExpression(n)) return;
                const ch = expectChain(n);
                if (!ch || ch.negated || !ch.subject) return;
                if (!EQ_MATCHERS_ANY.has(ch.matcher)) return;
                const a0 = ch.args[0];
                if (!a0 || !ts.isIdentifier(a0)) return;
                const initText = inits.get(a0.text);
                if (initText && containsCall(ch.subject) &&
                    ch.subject.getText(sf).replace(/\s+/g, " ").trim() === initText) {
                  push(lineOf(sf, n), "C11a", "expected value is bound from the same call under test");
                }
              });
            }
          }

          // D7: anonymous test (empty or missing description)
          const desc = node.arguments[0];
          const emptyStr = (d?: ts.Expression) => d !== undefined &&
            (ts.isStringLiteral(d) || ts.isNoSubstitutionTemplateLiteral(d)) && d.text.trim() === "";
          if (desc === cb || desc === undefined || emptyStr(desc)) {
            push(line, "D7", "test has no description");
          }

          // diagnostic group (maintainability; emitted always, filtered when off)
          const asserts: ts.Node[] = [];
          const consoles: ts.Node[] = [];
          const walkD = (n: ts.Node) => {
            if (isAssertionNode(n)) asserts.push(n);
            if (ts.isCallExpression(n) && calleeName(n.expression).startsWith("console.")) consoles.push(n);
            ts.forEachChild(n, walkD);
          };
          ts.forEachChild(cb, walkD);
          if (asserts.length >= DIAGNOSTIC_THRESHOLDS.assertionRoulette) {
            push(line, "D1", `${asserts.length} assertions in one test`);
          }
          const seenA = new Set<string>();
          for (const a of asserts) {
            const t = a.getText(sf).replace(/\s+/g, " ").trim();
            if (seenA.has(t)) { push(line, "D3", "an assertion is repeated"); break; }
            seenA.add(t);
          }
          for (const c of consoles) push(lineOf(sf, c), "D6", "console call in a test body");
          const startL = sf.getLineAndCharacterOfPosition(cb.body.getStart(sf)).line;
          const endL = sf.getLineAndCharacterOfPosition(cb.body.getEnd()).line;
          if (endL - startL > DIAGNOSTIC_THRESHOLDS.longTest) {
            push(line, "M2", `test body spans ${endL - startL} lines`);
          }
        }
      }

      // JS6: empty describe/suite block
      if (SUITE_ROOTS.has(root)) {
        const cb = getTestCallback(node);
        if (cb && cb.body && ts.isBlock(cb.body) && cb.body.statements.length === 0) {
          push(lineOf(sf, node), "JS6", "suite body is empty");
        }
      }

      // JS2: bare expect(x) with no matcher
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "expect" &&
        !ts.isPropertyAccessExpression(node.parent)
      ) {
        push(lineOf(sf, node), "JS2", "expect(...) is not chained to a matcher");
      }

      // assert(literal) -> C5
      if ((root === "assert" || name === "assert.ok") && literalTruthiness(node.arguments[0]) === true) {
        push(lineOf(sf, node), "C5", "assert on a constant truthy value");
      }

      // expect-chain matchers (C5, C7, C8)
      const chain = expectChain(node);
      if (chain && chain.subject) {
        const r = rootIdent(chain.subject);
        if (r) expectRoots.add(r);
      }
      if (chain && !chain.negated) {
        const subj = chain.subject;
        const arg = chain.args[0];
        // C9 over-broad throw assertion: toThrow() with no error type or message
        if ((chain.matcher === "toThrow" || chain.matcher === "toThrowError") && chain.args.length === 0) {
          push(lineOf(sf, node), "C9", "toThrow() with no error type or message accepts any error");
        }
        // JS15 inappropriate assertion: the comparison is wrapped in a boolean, so
        // the matcher only sees true/false (expect(a === b).toBe(true)). The failure
        // message is blind ("expected false to be true") and the oracle is weak.
        const COMPARISON_OPS = new Set<ts.SyntaxKind>([
          ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
          ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
        ]);
        const subjIsComparison = subj !== undefined && ts.isBinaryExpression(subj) &&
          COMPARISON_OPS.has(subj.operatorToken.kind);
        const boolMatcher =
          ((chain.matcher === "toBe" || chain.matcher === "toEqual" || chain.matcher === "toStrictEqual") &&
            arg !== undefined && (arg.kind === ts.SyntaxKind.TrueKeyword || arg.kind === ts.SyntaxKind.FalseKeyword)) ||
          chain.matcher === "toBeTruthy" || chain.matcher === "toBeFalsy";
        if (subjIsComparison && boolMatcher) {
          push(lineOf(sf, node), "JS15", "comparison wrapped in a boolean; assert the values directly");
        }
        // C44 numeric tautology: `expect(x.length).toBeGreaterThanOrEqual(0)`.
        // A `.length` is never negative and never NaN, so `>= 0` holds for every
        // input and verifies nothing — the JS/TS mirror of the Python `len(x) >= 0`.
        // The subject must be a DIRECT property access ending in `.length`: a derived
        // expression that merely mentions `.length` (e.g. `a.length - b.length`) can
        // be negative, so it is a real check and is not flagged. Bounds that can still
        // fail (`>= 1`, `> 0`) are not tautologies either. Finiteness/NaN guards
        // (`toBeLessThan(Infinity)`, `toBeGreaterThan(-Infinity)`) are intentionally
        // NOT flagged: they are false for NaN (and `Infinity`), so they catch
        // divide-by-zero and invalid-number bugs.
        if (
          chain.matcher === "toBeGreaterThanOrEqual" &&
          arg && ts.isNumericLiteral(arg) && Number(arg.text) === 0 &&
          subj && ts.isPropertyAccessExpression(subj) && subj.name.text === "length"
        ) {
          push(lineOf(sf, node), "C44", "length is never negative; this comparison is always true");
        }
        // D8 (diagnostic, opt-in): a magic integer literal as the expected value.
        // Floats are C8's concern; D8 covers bare integers abs > 1.
        if ((chain.matcher === "toBe" || chain.matcher === "toEqual" || chain.matcher === "toStrictEqual") &&
            arg && ts.isNumericLiteral(arg)) {
          const v = Number(arg.text);
          if (Number.isInteger(v) && Math.abs(v) > 1) {
            push(lineOf(sf, node), "D8", `magic number ${arg.text} in the assertion`);
          }
        }
        // C6 weak check: truthiness/defined-only, or length > 0, on a real (non-literal) value
        if (subj && !isLiteral(subj) && !subjIsComparison) {
          if (chain.matcher === "toBeTruthy" || chain.matcher === "toBeFalsy" || chain.matcher === "toBeDefined") {
            push(lineOf(sf, node), "C6", "only checks the value is present, not the expected result");
          } else if (arg && ts.isNumericLiteral(arg) &&
                     ((chain.matcher === "toBeGreaterThan" && Number(arg.text) === 0) ||
                      (chain.matcher === "toBeGreaterThanOrEqual" && Number(arg.text) === 1)) &&
                     /\.length\b/.test(subj.getText(sf))) {
            push(lineOf(sf, node), "C6", "only checks it is not empty");
          }
        }
        // C5 always-true
        if (chain.matcher === "toBeTruthy" && literalTruthiness(subj) === true) {
          push(lineOf(sf, node), "C5", "toBeTruthy on a constant truthy literal");
        } else if (
          (chain.matcher === "toBeFalsy" || chain.matcher === "toBeNull" || chain.matcher === "toBeUndefined") &&
          literalTruthiness(subj) === false
        ) {
          push(lineOf(sf, node), "C5", `${chain.matcher} on a constant falsy literal`);
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && isLiteral(subj) && isLiteral(arg) &&
                   subj!.getText(sf) === arg!.getText(sf)) {
          push(lineOf(sf, node), "C5", "both sides are the same literal");
        } else if (
          EQUALITY_MATCHERS.has(chain.matcher) && subj && arg &&
          !isLiteral(subj) && !containsCall(subj) &&
          subj.getText(sf) === arg.getText(sf)
        ) {
          // C7 self-compare
          push(lineOf(sf, node), "C7", "expected value is the same expression as the subject");
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && arg && ts.isNumericLiteral(arg) && !isLiteral(subj)) {
          // C8 exact float — on a real (non-literal) subject. A literal-vs-literal
          // float (expect(0.1).toBe(0.3)) is JS30, the stronger both-literals lane.
          const v = Number(arg.text);
          if (!Number.isInteger(v) && v !== 0 && v !== 1) {
            push(lineOf(sf, node), "C8", "exact equality on a float; use toBeCloseTo");
          }
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && isStringify(subj) && arg && ts.isStringLiteral(arg)) {
          // C18 sensitive equality: compares the stringified form to a literal
          push(lineOf(sf, node), "C18", "compares the stringified form of a value to a literal");
        }

        // JS30: literal-vs-literal through an equality matcher — both operands are
        // fixed at parse time, so the comparison is independent of any production
        // code. Different-token only (the same-token case is C5's "both sides are
        // the same literal"); object/array literals (reference-equality, false-red)
        // and template literals with substitutions (C18 lane) are excluded by
        // isLiteral. Broader matcher set than C5/C7 (adds toBeCloseTo + chai/AVA
        // equal/equals/eql/is). Negation already filtered (chain.negated).
        if (EQ_MATCHERS_ANY.has(chain.matcher) && isLiteral(subj) && isLiteral(arg) &&
            subj!.getText(sf) !== arg!.getText(sf)) {
          push(lineOf(sf, node), "JS30", "both operands are literals; the comparison is fixed at parse time");
        }

        // C8b: toBeCloseTo called with no precision argument — only the expected
        // value, so the default 2-digit tolerance applies. The js analogue of
        // assertAlmostEqual/pytest.approx with no tolerance: implicit-precision only.
        // A literal-vs-literal toBeCloseTo is JS30's stronger lane, so skip it here.
        if (chain.matcher === "toBeCloseTo" && chain.args.length === 1 &&
            !(isLiteral(subj) && isLiteral(arg))) {
          push(lineOf(sf, node), "C8b", "toBeCloseTo with no precision; the default 2-digit tolerance may be too loose");
        }
      }

      // C16 nondeterminism
      if (!fakeTimers) {
        const detail = c16Detail(node);
        if (detail) push(lineOf(sf, node), "C16", detail);
      }

      // C23 mystery guest: real file at a literal path, or a hard-coded URL
      {
        const leaf = name.split(".").pop() ?? "";
        const a0 = node.arguments[0];
        const lit = a0 && ts.isStringLiteral(a0) ? a0.text : null;
        if (lit && /^(readFileSync|readFile|openSync|createReadStream)$/.test(leaf) && /[\\/]/.test(lit)) {
          push(lineOf(sf, node), "C23", "reads a real file at a literal path");
        } else if (lit && (leaf === "fetch" || name === "fetch" || leaf === "get") && /^https?:\/\//i.test(lit)) {
          push(lineOf(sf, node), "C23", "hard-coded URL (mystery guest)");
        }
      }

      // JS5: async query/event whose settled state is dropped. Detection runs
      // through the oracle registry: a `promise` or `value-only` call (Testing
      // Library findBy*/waitFor*, user-event, Vue/Svelte flushPromises/nextTick/
      // tick) that is not awaited, returned, assigned, or `void`-discarded leaves
      // the following assertion reading a stale moment. The Vue/Svelte helpers are
      // only their promise form when called with no callback argument; nextTick(cb)
      // is the callback form and settles on its own.
      {
        const kind = oracleKind(name);
        const leaf = name.split(".").pop() ?? "";
        const isVueSvelte = VUE_SVELTE_ASYNC.has(leaf);
        const promiseForm = !isVueSvelte || node.arguments.length === 0;
        if ((kind === "promise" || kind === "value-only") && promiseForm && !isObservedAsync(node)) {
          push(lineOf(sf, node), "JS5", isVueSvelte ? `${leaf}() is not awaited` : `${name} is not awaited`);
        }
      }

      // JS7: a deferred assertion. One code, two mechanisms tagged in `detail`:
      //   timer arm   — assertion in a setTimeout/setInterval callback that is
      //                 never flushed. Suppression is precise (timerIsControlled):
      //                 scoped to the enclosing it/test callback and order-aware —
      //                 a fake-timer install BEFORE the arm, or a flush/advance
      //                 AFTER it, in the same callback. A flush before the arm
      //                 (callback never ran) or a flush in a different test does
      //                 not count, so it still runs after the test reports green.
      //   promise arm — assertion in a floating .then/.catch/.finally (the call
      //                 is a bare statement, not awaited/returned/chained), so it
      //                 may not run before the test ends.
      {
        const leaf = name.split(".").pop() ?? "";
        const isTimer = name === "setTimeout" || name === "setInterval";
        const isThen = leaf === "then" || leaf === "catch" || leaf === "finally";
        if (isTimer || isThen) {
          const cb = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
          if (cb && containsAssertion(cb)) {
            const awaitedOrChained = !ts.isExpressionStatement(node.parent);
            if (isTimer && !timerIsControlled(node, sf)) {
              push(lineOf(sf, node), "JS7",
                `assertion deferred into ${name}; runs after the test ends`);
            } else if (isThen && !awaitedOrChained) {
              push(lineOf(sf, node), "JS7",
                `assertion deferred into a floating .${leaf}(); may not run before the test ends`);
            }
          }
          // JS26: fake timers installed but never advanced. The setTimeout/setInterval
          // is armed, fake timers freeze it, and nothing in the same test scope (nor a
          // sibling before/after hook) calls runAllTimers/advanceTimersByTime/tick — so
          // the scheduled callback never fires and any assertion runs against the
          // un-mutated initial state. Opposite of C16 (uncontrolled timer): here the
          // timer is controlled but not advanced. Requires an assertion in scope so a
          // pure setup arm with no oracle is not flagged. Kept low (legit "assert
          // nothing happened yet" exists). FP guard: any flush in the body or a
          // before/afterEach of the enclosing describe suppresses it.
          if (isTimer) {
            const scope = enclosingTestScope(node);
            if (timerInstalledNeverAdvanced(scope, node, sf) && hasAssertion(scope)) {
              push(lineOf(sf, node), "JS26",
                `${name} scheduled under fake timers that are never advanced; the callback never fires`);
            }
          }
        }
      }

      // JS29: an expect(...).resolves/.rejects chain that is a bare statement, not
      // awaited, returned, or collected. The matcher only settles asynchronously, so
      // a floating chain finishes green before it resolves. The statically-provable
      // subset of JS20 (no type inference needed: the explicit .resolves/.rejects
      // marker is the signal). FP guard: only the explicit resolves/rejects member
      // (a plain promise stays JS20-out); awaited/returned/collected suppresses it.
      if (expectIsResolvesRejects(node) && !isObservedAsync(node)) {
        push(lineOf(sf, node), "JS29",
          "resolves/rejects assertion is not awaited or returned; it settles after the test ends");
      }

      // JS13: a sync query used as a loose statement (result never asserted).
      // Testing Library getBy*/queryBy*, and Vue Test Utils findComponent /
      // findAllComponents always, or find/findAll with a string selector (which
      // distinguishes wrapper.find('.btn') from Array.prototype.find(fn)).
      if (ts.isExpressionStatement(node.parent)) {
        const qleaf = name.split(".").pop() ?? "";
        const isRtlQuery = /^(getBy|getAllBy|queryBy|queryAllBy)/.test(qleaf);
        const isVueComponentQuery = qleaf === "findComponent" || qleaf === "findAllComponents";
        const isVueSelectorQuery = (qleaf === "find" || qleaf === "findAll") &&
          node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]);
        // A cy-rooted chain belongs to JS24, not JS13: cy.get("ul").find("li") ends in
        // .find("li") and would otherwise trip the Vue-selector heuristic (double-report).
        if ((isRtlQuery || isVueComponentQuery || isVueSelectorQuery) && rootIdent(node) !== "cy") {
          push(lineOf(sf, node), "JS13", `${qleaf}() result is not asserted`);
        }
        // JS24: the cy.* analogue of JS13 — a Cypress query chain (cy.get/find/
        // contains) as a statement with no terminating .should/.and and no expect
        // in a .then callback. Only query commands produce a subject; action
        // commands (click/type/visit/...) do work and stay clean.
        if (isUnassertedCyQuery(node)) {
          push(lineOf(sf, node), "JS24", `cy query (${qleaf}) result is not asserted`);
        }
      }

      // A runner `.each` table: it.each / test.each / describe.each (and fit/xit
      // variants). Gate the each-table codes on a runner root so a plain helper
      // like `_.each([], fn)` or `lodash.each([])` is never mistaken for a test table.
      const eachRoot = name.split(".")[0];
      const isRunnerEach = name.endsWith(".each") &&
        (TEST_BLOCK_ROOTS.has(eachRoot) || SUITE_ROOTS.has(eachRoot) ||
         eachRoot === "fit" || eachRoot === "xit");

      // JS22: empty it.each/test.each table — zero cases are generated, so the
      // test is collected but never runs and the suite stays green.
      if (isRunnerEach && node.arguments.length > 0 &&
          ts.isArrayLiteralExpression(node.arguments[0]) && node.arguments[0].elements.length === 0) {
        push(lineOf(sf, node), "JS22", "empty .each table — the test runs zero times");
      }

      // C37: duplicate case in it.each/test.each table
      if (isRunnerEach && node.arguments.length > 0 && ts.isArrayLiteralExpression(node.arguments[0])) {
        const seen = new Set<string>();
        for (const el of node.arguments[0].elements) {
          const t = el.getText(sf).replace(/\s+/g, " ").trim();
          if (seen.has(t)) { push(lineOf(sf, node), "C37", "duplicate case in the .each table"); break; }
          seen.add(t);
        }
      }

      // D4: it.each/test.each with untitled cases (no %s/%i placeholder)
      if (ts.isCallExpression(node.expression)) {
        const innerName = calleeName(node.expression.expression);
        const innerRoot = innerName.split(".")[0];
        if (innerName.endsWith(".each") && (TEST_BLOCK_ROOTS.has(innerRoot) || SUITE_ROOTS.has(innerRoot))) {
          const title = node.arguments[0];
          if (title && ts.isStringLiteral(title) && !title.text.includes("%")) {
            push(lineOf(sf, node), "D4", "each cases are not titled");
          }
        }
      }
    }

    // JS9: assertion in a dead branch with a literal condition
    if (ts.isIfStatement(node)) {
      const cond = literalTruthiness(node.expression);
      if (cond === false && containsAssertion(node.thenStatement)) {
        push(lineOf(sf, node), "JS9", "assertion in an if(false) branch");
      } else if (cond === true && node.elseStatement && containsAssertion(node.elseStatement)) {
        push(lineOf(sf, node), "JS9", "assertion in the else of an if(true)");
      }
    }

    // JS11: try block asserts, catch swallows the failure
    if (ts.isTryStatement(node) && node.catchClause) {
      if (containsAssertion(node.tryBlock) && isHarmlessCatch(node.catchClause.block)) {
        push(lineOf(sf, node), "JS11", "a failing assertion in try is swallowed by catch");
      } else if (
        // JS31: the try calls production code that may throw, the catch neither
        // asserts on the exception, re-raises, nor calls fail() — so a unit that
        // STOPS throwing (a real regression) still passes green. Complement of JS11
        // (which owns the swallowed-assertion case): JS31 fires only when the try
        // has a call but NO assertion (otherwise JS11), and the catch is harmless.
        // FP guard: a catch that asserts on e / re-throws / calls fail() makes
        // isHarmlessCatch false; a toThrow/assert.throws oracle in the try would be
        // an assertion (so JS31 is skipped, the throw is covered).
        containsCall(node.tryBlock) &&
        catchSilentlySwallows(node.catchClause.block)
      ) {
        push(lineOf(sf, node), "JS31", "try/catch swallows a possible throw with no assertion on the exception");
      }
    }

    // JS21: a matcher referenced but never called — `expect(x).toBe;` with no (),
    // so the assertion object is built and dropped; nothing executes. The chain
    // must be a bare statement (a call would make node.parent a CallExpression).
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text.startsWith("to") &&
      ts.isExpressionStatement(node.parent) &&
      expectRooted(node.expression)
    ) {
      push(lineOf(sf, node), "JS21", `${node.name.text} is referenced but never called`);
    }

    // C16: `new Date()` with no argument reads the system clock (nondeterministic).
    // `new Date(literal)` / `new Date(expr)` constructs a fixed instant, so it stays
    // clean; the file-wide fake-timer suppression applies here too.
    if (
      !fakeTimers &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      push(lineOf(sf, node), "C16", "new Date() reads the system clock");
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  // JS8: a mocked module's imported binding is asserted directly -> testing the mock,
  // not the real unit. Conservative: same module both mocked and imported, and that
  // import used as an expect subject.
  for (const [binding, mod] of importBinding) {
    if (mockedAt.has(mod) && expectRoots.has(binding)) {
      findings.push(makeFinding(file, mockedAt.get(mod)!, "JS8",
        `${binding} (from ${mod}) is mocked and asserted directly`));
      break;
    }
  }

  // CC: commented-out assertion (text scan over single-line comments)
  // CC: a single-line `//` comment that is a commented-out assertion call.
  // Requires the call paren (expect(/assert(/assert.x() or a .should chain) so it
  // does not match JSDoc prose like ` * assert that ...`.
  const lines = text.split(/\r?\n/);
  const ccRe = /^\s*\/\/\s*(?:await\s+)?(?:expect\s*\(|assert(?:\.\w+)?\s*\(|[\w.]+\.should\b)/;
  // JS17: a commented-out test block (// it('...', / // test(...) / // describe(...)),
  // optionally with .skip/.only/.each. A disabled test that no longer runs and no
  // longer shows up as skipped.
  const js17Re = /^\s*\/\/\s*(?:it|test|describe|context|specify)(?:\.\w+)?\s*\(/;
  lines.forEach((ln, i) => {
    if (ccRe.test(ln)) push(i + 1, "CC", "assertion is commented out");
    else if (js17Re.test(ln)) push(i + 1, "JS17", "test block is commented out");
  });

  return findings;
}
