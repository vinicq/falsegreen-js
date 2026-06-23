/**
 * Case catalog for falsegreen-js. Mirrors falsegreen (Python) where the smell is
 * the same concept (shared C-codes, so cross-language paper comparison lines up),
 * plus JS/TS-specific codes (JS-prefix) for ecosystem-only patterns.
 *
 * confidence: "high" => blocks (exit 20); "low" => warns (exit 10); "off" => silent.
 * judgment: which semantic question (J1-J6, see falsegreen-skill) the code belongs to.
 */

export type Confidence = "high" | "low" | "off";

export const JUDGMENTS: Record<string, string> = {
  J1: "does the assertion actually run?",
  J2: "is the oracle independent of the code?",
  J3: "does it exercise the real unit, or a stand-in?",
  J4: "does it check enough, and the right thing?",
  J5: "is it coupled to internals it should not see?",
  J6: "does it pass in isolation, or only via shared state?",
};

export interface CaseDef {
  title: string;
  confidence: Confidence;
  judgment: keyof typeof JUDGMENTS;
}

export const CASES: Record<string, CaseDef> = {
  // --- shared concept with falsegreen (same code id) -----------------------
  C2:  { title: "test with no check at all (empty body)", confidence: "high", judgment: "J1" },
  C2b: { title: "test calls things but checks nothing", confidence: "low", judgment: "J1" },
  C5:  { title: "always-true check (expect(true).toBe(true), assert(1))", confidence: "high", judgment: "J2" },
  C6:  { title: "weak check — only verifies something came back (toBeTruthy/toBeDefined, length > 0)", confidence: "low", judgment: "J4" },
  C7:  { title: "compares a thing to itself (expect(x).toBe(x))", confidence: "high", judgment: "J2" },
  C20: { title: "assertion in dead code after a return/throw — it never runs", confidence: "high", judgment: "J1" },
  C23: { title: "reads a real file at a literal path or hits a hard-coded URL (mystery guest)", confidence: "low", judgment: "J6" },
  C8:  { title: "exact equality on a float (fails on rounding, not bugs)", confidence: "low", judgment: "J4" },
  C16: { title: "result depends on time, randomness or a fixed timer", confidence: "low", judgment: "J1" },
  C18: { title: "compares String()/JSON.stringify()/`${x}` of a value to a literal (checks formatting, not the value)", confidence: "low", judgment: "J2" },
  C21: { title: "every assertion is conditional — none runs unconditionally", confidence: "low", judgment: "J1" },
  C9:  { title: "expect(...).toThrow() with no error type or message — accepts any error", confidence: "low", judgment: "J4" },
  C37: { title: "duplicate case in it.each/test.each — the same scenario runs twice", confidence: "low", judgment: "J4" },
  CC:  { title: "commented-out assertion (check switched off)", confidence: "low", judgment: "J1" },

  // --- JS/TS ecosystem-specific --------------------------------------------
  JS1: { title: "focused test (it.only / fit / describe.only) silently skips the rest of the suite", confidence: "high", judgment: "J1" },
  JS2: { title: "expect(x) with no matcher — the assertion is never executed", confidence: "high", judgment: "J1" },
  JS3: { title: "snapshot is the only assertion (toMatchSnapshot generated from the output itself)", confidence: "low", judgment: "J2" },
  JS4: { title: "skipped test (it.skip / xit / xdescribe / it.todo) never runs", confidence: "low", judgment: "J1" },
  JS5: { title: "async query/event not awaited (findBy* / waitFor / user-event) — the assertion may never settle", confidence: "low", judgment: "J1" },
  JS6: { title: "empty describe/suite block — the suite reports green but runs nothing", confidence: "high", judgment: "J1" },
  JS7: { title: "assertion inside a non-awaited setTimeout/setInterval/then callback — it may run after the test ends", confidence: "low", judgment: "J1" },
  JS8: { title: "mocks the unit under test (jest.mock/vi.mock of an imported module asserted directly) — tests the mock, not the code", confidence: "low", judgment: "J3" },
  JS9: { title: "assertion in a dead branch (if(false) / if(true){}else) — it never runs", confidence: "high", judgment: "J1" },
  JS11: { title: "try/catch swallows the assertion — a failing expect is caught and the test stays green", confidence: "low", judgment: "J1" },
  JS13: { title: "query (getBy*/queryBy*/wrapper.find) as a loose statement — its result is never asserted", confidence: "low", judgment: "J4" },
  JS15: { title: "inappropriate assertion — the comparison is wrapped in a boolean (expect(a===b).toBe(true)), so the failure message is blind", confidence: "low", judgment: "J4" },
  JS17: { title: "commented-out test block (// it(...) / // test(...)) — a disabled test that no longer runs", confidence: "low", judgment: "J1" },
  JS18: { title: "test takes a done callback instead of async/await — a done called too early (or in a floating promise) passes before the assertions run", confidence: "low", judgment: "J1" },
  JS21: { title: "matcher referenced but never called (expect(x).toBe with no ()) — the assertion never executes", confidence: "high", judgment: "J1" },
  JS22: { title: "empty it.each/test.each table — the test is generated with zero cases and never runs", confidence: "high", judgment: "J1" },

  // --- diagnostic group (maintainability; default off, opt-in via --diagnostics
  // or config severity). These are NOT false-green: the test still protects. They
  // are a "plus" for test-code health, mirroring falsegreen's D/M group. -------
  D1: { title: "assertion roulette — many assertions in one test; a failure does not say which", confidence: "off", judgment: "J4" },
  D3: { title: "duplicate assert — the same assertion appears more than once in a test", confidence: "off", judgment: "J4" },
  D4: { title: "it.each/test.each without titled cases — a failing case is identified only by its index", confidence: "off", judgment: "J4" },
  D6: { title: "console.* in a test body — a debug artifact that bypasses the oracle", confidence: "off", judgment: "J4" },
  D7: { title: "anonymous test — empty or missing description", confidence: "off", judgment: "J4" },
  D8: { title: "magic number in an assertion — a bare numeric literal instead of a named constant", confidence: "off", judgment: "J4" },
  M2: { title: "test body exceeds the line-count threshold — hard to read and maintain", confidence: "off", judgment: "J5" },
};

/** Default thresholds for the diagnostic group (overridable later via config). */
export const DIAGNOSTIC_THRESHOLDS = { assertionRoulette: 5, longTest: 50 };

export function groupOf(code: string): "false-positive" | "diagnostic" | "coupling" {
  if (code.startsWith("D")) return "diagnostic";
  if (code.startsWith("M")) return "coupling";
  return "false-positive";
}

/** Test-pyramid level, detected from a file's import roots (see level.ts). */
export type PyramidLevel = "unit" | "integration" | "e2e";

/**
 * One-line remediation per case: what to change so the test protects something.
 * Short, imperative, no trailing period. Surfaced in the status report (text +
 * JSON `fix` field). A code missing here renders no fix line, never throws.
 */
export const FIX_HINTS: Record<string, string> = {
  C2:  "add an assertion that checks the behaviour under test",
  C2b: "assert the result of the call, not just that it ran",
  C5:  "assert the real behaviour, not a constant or tautology",
  C6:  "assert the actual value, not just that something came back",
  C7:  "compare against an independent expected value, not the subject itself",
  C20: "move the assertion before the return/throw so it runs",
  C23: "use a fixture or temp file instead of a real path or hard-coded URL",
  C8:  "use toBeCloseTo() or a tolerance instead of exact float equality",
  C16: "freeze time and seed randomness so the result is deterministic",
  C18: "assert the value, not its String()/JSON.stringify() form",
  C21: "add at least one assertion that runs unconditionally",
  C9:  "pass an error type or message to toThrow()",
  C37: "remove the duplicate it.each/test.each case",
  CC:  "restore the commented-out assertion, or delete it",
  JS1: "remove .only (it.only/fit/describe.only) so the whole suite runs",
  JS2: "add a matcher (expect(x).toBe(...)) so the assertion runs",
  JS3: "add a real assertion; don't rely only on a self-generated snapshot",
  JS4: "remove .skip/xit/todo, or implement the test",
  JS5: "await the async query/event before asserting",
  JS6: "add tests to the describe block, or remove it",
  JS7: "await the promise/timer, or assert synchronously",
  JS8: "unmock the unit under test; mock only its collaborators",
  JS9: "remove the dead branch so the assertion runs",
  JS11: "let the assertion error propagate; don't catch it",
  JS13: "assert on the query result, not just query it",
  JS15: "expect the value directly (expect(a).toBe(b)), not a boolean",
  JS17: "restore the commented-out test, or delete it",
  JS18: "use async/await instead of the done callback",
  JS21: "call the matcher (add ()) so the assertion executes",
  JS22: "add at least one row to the it.each/test.each table",
  D1: "give each assertion a message, or split the test",
  D3: "remove the duplicate assertion",
  D4: "add titled cases to it.each/test.each",
  D6: "remove console.* or replace it with an assertion",
  D7: "give the test a description",
  D8: "name the magic number with a constant",
  M2: "split the long test into focused cases",
};
