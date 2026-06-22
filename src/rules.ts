import ts from "typescript";
import { Finding, makeFinding } from "./types.js";
import { lineOf } from "./parse.js";

// --- test framework vocabulary (runner-agnostic) ---------------------------
// it/test/specify (Jest, Vitest, Mocha, Jasmine, AVA, node:test, Cypress,
// Playwright, tap). describe/context/suite are suites. fit/fdescribe focus and
// xit/xdescribe skip come from Jasmine/Mocha.
const TEST_BLOCK_ROOTS = new Set(["it", "test", "specify"]);
const SUITE_ROOTS = new Set(["describe", "context", "suite", "fdescribe", "xdescribe", "fcontext", "xcontext"]);
const FOCUS_NAMES = new Set(["fit", "fdescribe", "fcontext"]);
const SKIP_NAMES = new Set(["xit", "xdescribe", "xcontext", "xspecify"]);

// Roots whose `<root>.<method>()` call counts as an assertion across runners:
// AVA (t), node:test/tap (t), Cypress (cy), chai assert, sinon.assert.
const ASSERT_ROOTS = new Set(["assert", "t", "cy", "tap", "qunit", "sinon", "chai", "should"]);
// Assertion method names used by AVA / tap / node:test / chai assert / QUnit.
const ASSERT_METHODS = new Set([
  "is", "not", "ok", "notOk", "true", "false", "truthy", "falsy",
  "equal", "notEqual", "deepEqual", "notDeepEqual", "strictEqual",
  "same", "notSame", "throws", "notThrows", "throwsAsync", "regex", "notRegex",
  "pass", "fail", "assert", "expect", "include", "match",
]);
const SNAPSHOT_MATCHERS = new Set([
  "toMatchSnapshot", "toMatchInlineSnapshot",
  "toThrowErrorMatchingSnapshot", "toThrowErrorMatchingInlineSnapshot",
]);
const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

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

// --- assertion presence ----------------------------------------------------
function isAssertionNode(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const parts = name.split(".");
    const root = parts[0];
    const leaf = parts[parts.length - 1];
    // expect(x).matcher(...) — Jest, Vitest, Jasmine, Playwright, jest-dom, chai expect
    if (root === "expect" && ts.isPropertyAccessExpression(node.expression)) return true;
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

function getTestCallback(call: ts.CallExpression): ts.FunctionLikeDeclaration | null {
  for (const arg of call.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  }
  return null;
}

// --- JS5: async query/event not awaited (Testing Library) ------------------
const ASYNC_AWAIT_LEAVES = new Set(["waitFor", "waitForElementToBeRemoved"]);
function isAsyncQueryCall(name: string): boolean {
  const parts = name.split(".");
  const root = parts[0];
  const leaf = parts[parts.length - 1];
  if (root === "userEvent") return true;
  if (leaf.startsWith("findBy") || leaf.startsWith("findAllBy")) return true;
  return ASYNC_AWAIT_LEAVES.has(leaf);
}

// --- C16: nondeterminism ----------------------------------------------------
function c16Detail(call: ts.CallExpression): string | null {
  const name = calleeName(call.expression);
  if (name === "Math.random") return "Math.random() without a fixed seed";
  if (name === "Date.now" || name === "performance.now") return "reads the system clock";
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
  const fakeTimers = /\b(useFakeTimers)\b/.test(text);

  const push = (line: number, code: string, detail = ""): void => {
    findings.push(makeFinding(file, line, code, detail));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const root = name.split(".")[0];
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
        TEST_BLOCK_ROOTS.has(root) || root === "fit" || root === "xit" ||
        ((TEST_BLOCK_ROOTS.has(root)) && (modifier === "only" || modifier === "skip" || modifier === "each"));
      if (isTestBlock) {
        const cb = getTestCallback(node);
        if (cb && cb.body && ts.isBlock(cb.body)) {
          const stmts = cb.body.statements;
          const line = lineOf(sf, node);
          if (stmts.length === 0) {
            push(line, "C2", "test body is empty");
          } else if (!hasAssertion(cb) && containsCall(cb.body)) {
            push(line, "C2b", "calls code but never asserts");
          } else if (hasAssertion(cb)) {
            const ms = matchersUnder(cb);
            if (ms.length > 0 && ms.every((m) => SNAPSHOT_MATCHERS.has(m))) {
              push(line, "JS3", "the only assertion is a snapshot");
            }
          }
        }
      }

      // JS6: empty describe/suite block
      if (SUITE_ROOTS.has(root) || (SUITE_ROOTS.has(root) && (modifier === "only" || modifier === "skip"))) {
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
      if (chain && !chain.negated) {
        const subj = chain.subject;
        const arg = chain.args[0];
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
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && arg && ts.isNumericLiteral(arg)) {
          // C8 exact float
          const v = Number(arg.text);
          if (!Number.isInteger(v) && v !== 0 && v !== 1) {
            push(lineOf(sf, node), "C8", "exact equality on a float; use toBeCloseTo");
          }
        }
      }

      // C16 nondeterminism
      if (!fakeTimers) {
        const detail = c16Detail(node);
        if (detail) push(lineOf(sf, node), "C16", detail);
      }

      // JS5: Testing Library async query/event used without await
      if (isAsyncQueryCall(name) && ts.isExpressionStatement(node.parent)) {
        push(lineOf(sf, node), "JS5", `${name} is not awaited`);
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
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  // CC: commented-out assertion (text scan over single-line comments)
  // CC: a single-line `//` comment that is a commented-out assertion call.
  // Requires the call paren (expect(/assert(/assert.x() or a .should chain) so it
  // does not match JSDoc prose like ` * assert that ...`.
  const lines = text.split(/\r?\n/);
  const ccRe = /^\s*\/\/\s*(?:await\s+)?(?:expect\s*\(|assert(?:\.\w+)?\s*\(|[\w.]+\.should\b)/;
  lines.forEach((ln, i) => {
    if (ccRe.test(ln)) push(i + 1, "CC", "assertion is commented out");
  });

  return findings;
}
