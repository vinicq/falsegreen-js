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
