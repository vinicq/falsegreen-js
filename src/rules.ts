import ts from "typescript";
import { Finding, makeFinding } from "./types.js";
import { DIAGNOSTIC_THRESHOLDS } from "./cases.js";
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
  // visual snapshots (Playwright): the baseline is generated from the output too
  "toHaveScreenshot", "toMatchScreenshot",
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

const CONDITIONAL_ANCESTORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.ConditionalExpression,
]);

/** True if the function has at least one assertion and every one of them sits under a
 *  conditional (if/for/while/switch/catch/?:) — so none runs unconditionally (C21). */
function assertionsAllConditional(fn: ts.Node): boolean {
  const asserts: ts.Node[] = [];
  const walk = (n: ts.Node) => { if (isAssertionNode(n)) asserts.push(n); ts.forEachChild(n, walk); };
  ts.forEachChild(fn, walk);
  if (asserts.length === 0) return false;
  for (const a of asserts) {
    let p: ts.Node | undefined = a.parent;
    let conditional = false;
    while (p && p !== fn) {
      if (CONDITIONAL_ANCESTORS.has(p.kind)) { conditional = true; break; }
      p = p.parent;
    }
    if (!conditional) return false;
  }
  return true;
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
// Vue/Svelte async test helpers that return a promise and must be awaited.
const VUE_SVELTE_ASYNC = new Set(["flushPromises", "nextTick", "$nextTick", "tick"]);
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
        TEST_BLOCK_ROOTS.has(root) || root === "fit" || root === "xit" ||
        ((TEST_BLOCK_ROOTS.has(root)) && (modifier === "only" || modifier === "skip" || modifier === "each"));
      if (isTestBlock) {
        const cb = getTestCallback(node);
        if (cb && cb.body && ts.isBlock(cb.body)) {
          const stmts = cb.body.statements;
          const line = lineOf(sf, node);
          // C20: an assertion after a return/throw in the test body is dead code
          let terminated = false;
          for (const st of stmts) {
            if (terminated && containsAssertion(st)) {
              push(lineOf(sf, st), "C20", "assertion after a return/throw never runs");
            }
            if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) terminated = true;
          }
          if (stmts.length === 0) {
            push(line, "C2", "test body is empty");
          } else if (!hasAssertion(cb) && containsCall(cb.body)) {
            push(line, "C2b", "calls code but never asserts");
          } else if (hasAssertion(cb)) {
            const ms = matchersUnder(cb);
            if (ms.length > 0 && ms.every((m) => SNAPSHOT_MATCHERS.has(m))) {
              push(line, "JS3", "the only assertion is a snapshot");
            }
            if (assertionsAllConditional(cb)) {
              push(line, "C21", "every assertion is guarded by a condition");
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
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && arg && ts.isNumericLiteral(arg)) {
          // C8 exact float
          const v = Number(arg.text);
          if (!Number.isInteger(v) && v !== 0 && v !== 1) {
            push(lineOf(sf, node), "C8", "exact equality on a float; use toBeCloseTo");
          }
        } else if (EQUALITY_MATCHERS.has(chain.matcher) && isStringify(subj) && arg && ts.isStringLiteral(arg)) {
          // C18 sensitive equality: compares the stringified form to a literal
          push(lineOf(sf, node), "C18", "compares the stringified form of a value to a literal");
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

      // JS5: async query/event used without await. Testing Library (findBy*/waitFor/
      // user-event) plus Vue/Svelte async helpers (flushPromises/nextTick/tick) in
      // their promise form (no callback arg) used as a bare, non-awaited statement.
      if (isAsyncQueryCall(name) && ts.isExpressionStatement(node.parent)) {
        push(lineOf(sf, node), "JS5", `${name} is not awaited`);
      } else if (
        ts.isExpressionStatement(node.parent) && node.arguments.length === 0 &&
        VUE_SVELTE_ASYNC.has(name.split(".").pop() ?? "")
      ) {
        const leaf = name.split(".").pop();
        push(lineOf(sf, node), "JS5", `${leaf}() is not awaited`);
      }

      // JS7: assertion inside a non-awaited setTimeout/setInterval/then callback
      {
        const leaf = name.split(".").pop() ?? "";
        const isTimer = name === "setTimeout" || name === "setInterval";
        const isThen = leaf === "then" || leaf === "catch" || leaf === "finally";
        if (isTimer || isThen) {
          const cb = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
          if (cb && containsAssertion(cb)) {
            const awaitedOrChained = !ts.isExpressionStatement(node.parent);
            if (isTimer && !fakeTimers) {
              push(lineOf(sf, node), "JS7", `assertion inside a non-awaited ${name}() callback`);
            } else if (isThen && !awaitedOrChained) {
              push(lineOf(sf, node), "JS7", `assertion inside a non-awaited .${leaf}() callback`);
            }
          }
        }
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
        if (isRtlQuery || isVueComponentQuery || isVueSelectorQuery) {
          push(lineOf(sf, node), "JS13", `${qleaf}() result is not asserted`);
        }
      }

      // C37: duplicate case in it.each/test.each table
      if (name.endsWith(".each") && node.arguments.length > 0 && ts.isArrayLiteralExpression(node.arguments[0])) {
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
      }
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
  lines.forEach((ln, i) => {
    if (ccRe.test(ln)) push(i + 1, "CC", "assertion is commented out");
  });

  return findings;
}
