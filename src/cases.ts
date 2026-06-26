/**
 * Case catalog for falsegreen-js. Mirrors falsegreen (Python) where the smell is
 * the same concept (shared C-codes, so cross-language paper comparison lines up),
 * plus JS/TS-specific codes (JS-prefix) for ecosystem-only patterns.
 *
 * Each code carries four independent axes (none derived from another or from the
 * code prefix):
 *   group       conceptual failure mode (RiskGroup, closed taxonomy).
 *   severity    how serious the finding is when it fires ("high" | "low").
 *   defaultOn   whether the default scan emits it (false for the opt-in
 *               diagnostic group, surfaced only via --diagnostics).
 *   judgment    which semantic question (J1-J6, see falsegreen-skill) it answers.
 *
 * The effective "confidence" used downstream (high/low/off) is derived from
 * severity + defaultOn by baseConfidence(); the exit code is derived from the
 * severity of the findings that are actually emitted. Keeping the axes apart is
 * the point: a finding's taxonomy must not depend on whether it blocks.
 */

export type Confidence = "high" | "low" | "off";
export type Severity = "high" | "low";

/**
 * Conceptual failure mode — a closed taxonomy condensing the F1-F8 families to
 * six axes. Driven by the per-code table below (riskGroupOf), never by the code
 * prefix, and never defaulted: an unknown code is an error, not a guess.
 *
 *   effectiveness   no oracle, a trivial oracle, or the wrong oracle (F1/F3/F4).
 *   execution       the check exists but does not run, or the test vanishes from
 *                   the count (F2/F5).
 *   nondeterminism  passes or fails by luck — time, randomness, timers (F6).
 *   dependency      real I/O or a stand-in for the unit under test: mystery
 *                   guest, self-mock (isolation, J3/J6).
 *   structure       size/readability; the test still protects (F8 maintainability).
 *   diagnostic      opt-in health signal, off by default.
 */
export type RiskGroup =
  | "effectiveness"
  | "execution"
  | "nondeterminism"
  | "dependency"
  | "structure"
  | "diagnostic";

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
  group: RiskGroup;
  severity: Severity;
  defaultOn: boolean;
  judgment: keyof typeof JUDGMENTS;
}

export const CASES: Record<string, CaseDef> = {
  // --- shared concept with falsegreen (same code id) -----------------------
  C2:  { title: "test with no check at all (empty body)", group: "effectiveness", severity: "high", defaultOn: true, judgment: "J1" },
  C2b: { title: "test calls things but checks nothing", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J1" },
  C5:  { title: "always-true check (expect(true).toBe(true), assert(1))", group: "effectiveness", severity: "high", defaultOn: true, judgment: "J2" },
  C6:  { title: "weak check — only verifies something came back (toBeTruthy/toBeDefined, length > 0)", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  C7:  { title: "compares a thing to itself (expect(x).toBe(x))", group: "effectiveness", severity: "high", defaultOn: true, judgment: "J2" },
  C44: { title: "numeric tautology — a length compared so the result is always true (length >= 0)", group: "effectiveness", severity: "high", defaultOn: true, judgment: "J2" },
  C20: { title: "assertion in dead code after a return/throw — it never runs", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  C23: { title: "reads a real file at a literal path or hits a hard-coded URL (mystery guest)", group: "dependency", severity: "low", defaultOn: true, judgment: "J6" },
  C8:  { title: "exact equality on a float (fails on rounding, not bugs)", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  C16: { title: "result depends on time, randomness or a fixed timer", group: "nondeterminism", severity: "low", defaultOn: true, judgment: "J1" },
  C18: { title: "compares String()/JSON.stringify()/`${x}` of a value to a literal (checks formatting, not the value)", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J2" },
  C21: { title: "every assertion is conditional — none runs unconditionally", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  C9:  { title: "expect(...).toThrow() with no error type or message — accepts any error", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  C37: { title: "duplicate case in it.each/test.each — the same scenario runs twice", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  CC:  { title: "commented-out assertion (check switched off)", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },

  // --- JS/TS ecosystem-specific --------------------------------------------
  JS1: { title: "focused test (it.only / fit / describe.only) silently skips the rest of the suite", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  JS2: { title: "expect(x) with no matcher — the assertion is never executed", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  JS3: { title: "snapshot is the only assertion (toMatchSnapshot generated from the output itself)", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J2" },
  JS4: { title: "skipped test (it.skip / xit / xdescribe / it.todo) never runs", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS5: { title: "async query/event not awaited (findBy* / waitFor / user-event) — the assertion may never settle", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS6: { title: "empty describe/suite block — the suite reports green but runs nothing", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  JS7: { title: "assertion inside a non-awaited setTimeout/setInterval/then callback — it may run after the test ends", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS8: { title: "mocks the unit under test (jest.mock/vi.mock of an imported module asserted directly) — tests the mock, not the code", group: "dependency", severity: "low", defaultOn: true, judgment: "J3" },
  JS9: { title: "assertion in a dead branch (if(false) / if(true){}else) — it never runs", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  JS11: { title: "try/catch swallows the assertion — a failing expect is caught and the test stays green", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS13: { title: "query (getBy*/queryBy*/wrapper.find) as a loose statement — its result is never asserted", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  JS15: { title: "inappropriate assertion — the comparison is wrapped in a boolean (expect(a===b).toBe(true)), so the failure message is blind", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J4" },
  JS17: { title: "commented-out test block (// it(...) / // test(...)) — a disabled test that no longer runs", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS18: { title: "test takes a done callback instead of async/await — a done called too early (or in a floating promise) passes before the assertions run", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
  JS21: { title: "matcher referenced but never called (expect(x).toBe with no ()) — the assertion never executes", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },
  JS22: { title: "empty it.each/test.each table — the test is generated with zero cases and never runs", group: "execution", severity: "high", defaultOn: true, judgment: "J1" },

  // --- diagnostic group (maintainability; default off, opt-in via --diagnostics
  // or config severity). These are NOT false-green: the test still protects. They
  // are a "plus" for test-code health, mirroring falsegreen's D/M group. -------
  D1: { title: "assertion roulette — many assertions in one test; a failure does not say which", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  D3: { title: "duplicate assert — the same assertion appears more than once in a test", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  D4: { title: "it.each/test.each without titled cases — a failing case is identified only by its index", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  D6: { title: "console.* in a test body — a debug artifact that bypasses the oracle", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  D7: { title: "anonymous test — empty or missing description", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  D8: { title: "magic number in an assertion — a bare numeric literal instead of a named constant", group: "diagnostic", severity: "low", defaultOn: false, judgment: "J4" },
  M2: { title: "test body exceeds the line-count threshold — hard to read and maintain", group: "structure", severity: "low", defaultOn: false, judgment: "J5" },

  // --- project layer (config-audit only; emitted by --config-audit, never by
  // the per-file scan). The suite goes green by configuration, not by a smell
  // inside any one test file. ------------------------------------------------
  PL7:  { title: "no coverage gate (coverageThreshold / coverage.thresholds) - coverage can fall to zero and the suite still passes", group: "effectiveness", severity: "low", defaultOn: true, judgment: "J5" },
  PL8:  { title: "bail stops the run early (bail) - the reported test count is incomplete", group: "execution", severity: "low", defaultOn: true, judgment: "J5" },
  PL10: { title: "passWithNoTests lets an empty or fully-filtered suite report green", group: "execution", severity: "low", defaultOn: true, judgment: "J1" },
};

/** Default thresholds for the diagnostic group (overridable later via config). */
export const DIAGNOSTIC_THRESHOLDS = { assertionRoulette: 5, longTest: 50 };

/**
 * Effective default state of a code as a single value: its severity when the
 * default scan emits it, or "off" when it is opt-in. Derives the legacy
 * three-valued "confidence" from the independent severity + defaultOn axes, so
 * the rest of the pipeline (makeFinding, effectiveConf, exit code) keeps working
 * unchanged while the taxonomy stays separate from the blocking decision.
 */
export function baseConfidence(code: string): Confidence {
  const c = CASES[code];
  if (!c) throw new Error(`falsegreen-js: unknown code "${code}" — not in the case catalog`);
  return c.defaultOn ? c.severity : "off";
}

/**
 * Primary taxonomy: the conceptual failure mode, read from the closed per-code
 * table. Rejects an unknown code instead of defaulting, so a typo or a code that
 * was added to the rules but never classified fails loudly.
 */
export function riskGroupOf(code: string): RiskGroup {
  const c = CASES[code];
  if (!c) throw new Error(`falsegreen-js: unknown code "${code}" — not in the case catalog`);
  return c.group;
}

/**
 * Legacy product grouping (false-positive / diagnostic / coupling / project),
 * kept only as a transition-compat field in the JSON report. New consumers
 * should read `riskGroup` (riskGroupOf). Prefix-based by design: it mirrors the
 * pre-0.3 output exactly so downstream filters do not break across the upgrade.
 */
export function groupOf(code: string): "false-positive" | "diagnostic" | "coupling" | "project" {
  if (code.startsWith("PL")) return "project";
  if (code.startsWith("D")) return "diagnostic";
  if (code.startsWith("M")) return "coupling";
  return "false-positive";
}

/** Test-pyramid level, detected from a file's import roots (see level.ts).
 * `project` is the config-audit layer (--config-audit), not a file level. */
export type PyramidLevel = "unit" | "integration" | "e2e" | "project";

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
  C44: "assert the actual length, not that it is at least zero (always true)",
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
  JS7: "await the promise, or use/flush fake timers, or assert synchronously",
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
  PL7:  "set coverageThreshold (Jest) or coverage.thresholds (Vitest) to gate coverage",
  PL8:  "remove bail so the whole suite runs and the count is complete",
  PL10: "drop passWithNoTests so an empty or filtered-to-nothing run fails",
};
