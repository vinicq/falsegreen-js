/**
 * Oracle registry — the assertion-API vocabulary falsegreen-js understands, kept
 * as a single versioned table instead of scattered Sets across the rules.
 *
 * Each family is classified by how its failure reaches the runner. That kind is
 * what tells the async analysis whether a call settles synchronously, returns a
 * promise that must be awaited, or only produces a value:
 *
 *   sync-fail          throws synchronously on mismatch — a bare statement is
 *                      enough to fail the test (jest/vitest expect().matcher(),
 *                      node:assert, chai assert, sinon.assert).
 *   promise            returns a promise; the failure only surfaces if it is
 *                      awaited or returned (expect().resolves/.rejects, supertest
 *                      .expect() in its awaited form).
 *   runner-registered  registered with the runner; the framework collects the
 *                      result even from a fluent chain (AVA/node:test t.is,
 *                      Cypress cy.should, chai .should).
 *   value-only         produces a value but does not assert on its own; it must
 *                      feed an assertion (Testing Library getBy* and findBy*).
 *
 * Bump ORACLE_REGISTRY_VERSION when the classification changes, so a JSON report
 * records which vocabulary produced it.
 */

export const ORACLE_REGISTRY_VERSION = 2;

export type OracleKind = "sync-fail" | "promise" | "runner-registered" | "value-only";

/**
 * Roots whose `<root>.<method>()` call counts as an assertion across runners:
 * AVA / node:test / tap (t), Cypress (cy), chai assert, sinon.assert, QUnit.
 * These are runner-registered: the framework records the outcome.
 */
export const ASSERT_ROOTS = new Set(["assert", "t", "cy", "tap", "qunit", "sinon", "chai", "should"]);

/** Assertion method names used by AVA / tap / node:test / chai assert / QUnit. */
export const ASSERT_METHODS = new Set([
  "is", "not", "ok", "notOk", "true", "false", "truthy", "falsy",
  "equal", "notEqual", "deepEqual", "notDeepEqual", "strictEqual",
  "same", "notSame", "throws", "notThrows", "throwsAsync", "regex", "notRegex",
  "pass", "fail", "assert", "expect", "include", "match",
]);

/** Matchers whose baseline is generated from the output itself (snapshot family). */
export const SNAPSHOT_MATCHERS = new Set([
  "toMatchSnapshot", "toMatchInlineSnapshot",
  "toThrowErrorMatchingSnapshot", "toThrowErrorMatchingInlineSnapshot",
  // visual snapshots (Playwright): the baseline is generated from the output too
  "toHaveScreenshot", "toMatchScreenshot",
]);

/** Equality matchers (Jest/Vitest). */
export const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

/**
 * Testing Library async leaves that return a promise and must be awaited before
 * the assertion can settle (value-only / promise: findBy* resolve to an element,
 * waitFor* resolve when their callback stops throwing).
 */
export const ASYNC_AWAIT_LEAVES = new Set(["waitFor", "waitForElementToBeRemoved"]);

/** Vue/Svelte async test helpers that return a promise and must be awaited. */
export const VUE_SVELTE_ASYNC = new Set(["flushPromises", "nextTick", "$nextTick", "tick"]);

/**
 * Classify a call name (`root.leaf` or a bare identifier) by oracle kind. Returns
 * null when the name is not a known oracle. Conservative: only the vocabulary
 * above is classified; project-specific helpers are handled by naming convention
 * in the rules, not here.
 */
export function oracleKind(name: string): OracleKind | null {
  const parts = name.split(".");
  const root = parts[0];
  const leaf = parts[parts.length - 1];
  // expect(x).resolves/.rejects.matcher() — promise; plain expect().matcher() is sync-fail.
  if (root === "expect") return name.includes(".resolves") || name.includes(".rejects") ? "promise" : "sync-fail";
  if (root === "assert") return "sync-fail";
  if (root === "sinon" && name.includes("assert")) return "sync-fail";
  if (ASSERT_ROOTS.has(root) && ASSERT_METHODS.has(leaf)) return "runner-registered";
  if (leaf === "should") return "runner-registered";
  if (leaf.startsWith("findBy") || leaf.startsWith("findAllBy")) return "value-only";
  // @testing-library/user-event v14+: every action (click/type/keyboard/…) returns
  // a promise that must be awaited before the resulting state can be asserted.
  if (root === "userEvent") return "promise";
  if (ASYNC_AWAIT_LEAVES.has(leaf)) return "promise";
  if (VUE_SVELTE_ASYNC.has(leaf)) return "promise";
  return null;
}
