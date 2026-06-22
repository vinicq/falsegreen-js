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
  C7:  { title: "compares a thing to itself (expect(x).toBe(x))", confidence: "high", judgment: "J2" },
  C8:  { title: "exact equality on a float (fails on rounding, not bugs)", confidence: "low", judgment: "J4" },
  C16: { title: "result depends on time, randomness or a fixed timer", confidence: "low", judgment: "J1" },
  C18: { title: "compares String()/JSON.stringify()/`${x}` of a value to a literal (checks formatting, not the value)", confidence: "low", judgment: "J2" },
  C21: { title: "every assertion is conditional — none runs unconditionally", confidence: "low", judgment: "J1" },
  CC:  { title: "commented-out assertion (check switched off)", confidence: "low", judgment: "J1" },

  // --- JS/TS ecosystem-specific --------------------------------------------
  JS1: { title: "focused test (it.only / fit / describe.only) silently skips the rest of the suite", confidence: "high", judgment: "J1" },
  JS2: { title: "expect(x) with no matcher — the assertion is never executed", confidence: "high", judgment: "J1" },
  JS3: { title: "snapshot is the only assertion (toMatchSnapshot generated from the output itself)", confidence: "low", judgment: "J2" },
  JS4: { title: "skipped test (it.skip / xit / xdescribe / it.todo) never runs", confidence: "low", judgment: "J1" },
  JS5: { title: "async query/event not awaited (findBy* / waitFor / user-event) — the assertion may never settle", confidence: "low", judgment: "J1" },
  JS6: { title: "empty describe/suite block — the suite reports green but runs nothing", confidence: "high", judgment: "J1" },
  JS7: { title: "assertion inside a non-awaited setTimeout/setInterval/then callback — it may run after the test ends", confidence: "low", judgment: "J1" },
  JS9: { title: "assertion in a dead branch (if(false) / if(true){}else) — it never runs", confidence: "high", judgment: "J1" },
  JS11: { title: "try/catch swallows the assertion — a failing expect is caught and the test stays green", confidence: "low", judgment: "J1" },
};

export function groupOf(code: string): "false-positive" | "diagnostic" | "coupling" {
  if (code.startsWith("D")) return "diagnostic";
  if (code.startsWith("M")) return "coupling";
  return "false-positive";
}
