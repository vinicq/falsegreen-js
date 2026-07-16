import ts from "typescript";
import { PyramidLevel } from "./cases.js";

// Browser drivers and end-to-end frameworks. A test file importing one of these
// drives a real browser or a full stack: it is an E2E test.
const E2E_ROOTS = new Set<string>([
  "cypress", "@playwright/test", "playwright", "playwright-core",
  "selenium-webdriver", "webdriverio", "@wdio/globals", "puppeteer",
  "puppeteer-core", "protractor", "nightwatch", "testcafe",
]);

// HTTP clients / API mocks and real datastore drivers or ORMs. A test importing
// one of these crosses an I/O boundary (API or database): it is an integration
// test, where the response or the row is the oracle.
// HTTP client packages whose `.get(url)` is a real network fetch (vs. cache.get,
// map.get, redis.get). Used to anchor C23's hard-coded-URL clause so it fires
// only on an HTTP client root, not any `.get("http…")`. Subset of the API/HTTP
// entries in INTEGRATION_ROOTS.
export const HTTP_CLIENT_ROOTS = new Set<string>([
  "axios", "got", "superagent", "supertest", "request", "node-fetch",
  "cross-fetch", "undici", "pactum",
]);

const INTEGRATION_ROOTS = new Set<string>([
  // API / HTTP
  ...HTTP_CLIENT_ROOTS, "nock", "msw",
  // database drivers / ORMs
  "@prisma/client", "prisma", "typeorm", "sequelize", "mongoose", "mongodb",
  "pg", "mysql", "mysql2", "redis", "ioredis", "knex", "better-sqlite3",
  "sqlite3", "drizzle-orm", "testcontainers",
]);

/** The package root of a module specifier, or null for a relative import.
 * Scoped packages keep two segments (`@playwright/test`); others keep one. */
function packageRoot(spec: string): string | null {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Every module specifier imported or required in the file. */
function importRoots(sf: ts.SourceFile): Set<string> {
  const roots = new Set<string>();
  const add = (spec: string | undefined): void => {
    const root = spec ? packageRoot(spec) : null;
    if (root) roots.add(root);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const fn = node.expression;
      const isRequire = ts.isIdentifier(fn) && fn.text === "require";
      const isDynImport = fn.kind === ts.SyntaxKind.ImportKeyword;
      const arg = node.arguments[0];
      if ((isRequire || isDynImport) && arg && ts.isStringLiteral(arg)) add(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return roots;
}

/**
 * Map a test file to a pyramid level from its import roots: "e2e" (browser
 * driver / e2e framework), "integration" (HTTP client or database driver:
 * API and DB tests), or "unit" (neither). Broadest wins. A real API/DB import
 * in a test the author treats as a unit test is itself the smell, surfaced by
 * the level mismatch.
 */
export function detectPyramidLevel(sf: ts.SourceFile): PyramidLevel {
  const roots = importRoots(sf);
  for (const r of roots) if (E2E_ROOTS.has(r)) return "e2e";
  for (const r of roots) if (INTEGRATION_ROOTS.has(r)) return "integration";
  return "unit";
}

/** True if the file imports a Playwright test package (import / require / dynamic
 *  import — importRoots covers all three). Playwright's test.skip(cond) is a
 *  runtime conditional skip, not a declared disabled test, so JS4 treats it
 *  differently (see rules.ts). Playwright covers both UI E2E and API tests; both
 *  import the same package, so this flag applies to either. */
export function fileImportsPlaywright(sf: ts.SourceFile): boolean {
  const roots = importRoots(sf);
  return roots.has("@playwright/test") || roots.has("playwright") || roots.has("playwright-core");
}

// Members of the global `test` object that exist ONLY on Playwright's test API.
// AVA uses test.before/after (NOT *All) and test.beforeEach/afterEach (so those
// are deliberately excluded); Jest/Vitest/Mocha/Jasmine/node:test use bare
// describe/beforeAll/afterAll (un-namespaced). So a `test.<member>` call for any
// of these four is a false-positive-free "this file is Playwright" signal.
const PLAYWRIGHT_API_MEMBERS = new Set(["describe", "step", "beforeAll", "afterAll"]);

/** True if the file calls a Playwright-exclusive namespaced test member —
 *  test.describe / test.step / test.beforeAll / test.afterAll (incl. chained
 *  forms like test.describe.serial). Complements fileImportsPlaywright for suites
 *  that get `test`/`expect` from a fixture re-export (test.extend / mergeTests
 *  wrapper, e.g. `import { test } from "@mendix/run-e2e/fixtures"`) and so never
 *  import @playwright/test directly. AST-precise (not a text regex) so the names
 *  quoted in a comment or string do not trip the signal. */
export function fileUsesPlaywrightApi(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      // Descend to the property access whose base is the leftmost identifier, so
      // test.describe.serial(...) is read as the `describe` member after `test`.
      let pa: ts.PropertyAccessExpression = node.expression;
      while (ts.isPropertyAccessExpression(pa.expression)) pa = pa.expression;
      if (ts.isIdentifier(pa.expression) && pa.expression.text === "test" &&
          PLAYWRIGHT_API_MEMBERS.has(pa.name.text)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// A destructured test-callback fixture whose name only exists in Playwright:
// `browserName` is never injected by any other runner, so it alone identifies a
// Playwright file. Strong signal.
const PLAYWRIGHT_STRONG_FIXTURES = new Set(["browserName"]);
// Fixtures whose name ALSO appears elsewhere: `request` in supertest/Express
// handlers, `page` in Puppeteer, `context` broadly. Ambiguous — one of these
// alone must NOT identify Playwright (that would suppress a legit JS4 in a
// non-Playwright file: an FP traded for an FN). Only counts when corroborated.
const PLAYWRIGHT_AMBIGUOUS_FIXTURES = new Set(["page", "context", "request"]);
// expect() matchers that exist ONLY in Playwright (locator/APIResponse retrying
// matchers), deliberately excluding the jest-dom overlaps (toBeVisible/
// toBeChecked/toHaveValue/toHaveText/...). Presence of one corroborates an
// ambiguous fixture: `expect(res).toBeOK()` next to `({ request })` is Playwright.
const PLAYWRIGHT_EXCLUSIVE_MATCHERS = new Set([
  "toBeOK", "toHaveCount", "toHaveURL", "toHaveScreenshot", "toHaveTitle",
  "toContainText", "toBeInViewport", "toBeAttached", "toMatchAriaSnapshot",
  "toHaveValues", "toContainClass", "toHaveRole", "toHaveAccessibleName",
  "toHaveAccessibleDescription", "toPass",
]);

/** Weighted fixture-param signal for a flat Playwright spec that neither imports
 *  @playwright/test (fixture re-export) nor uses a namespaced test.* API member.
 *  Returns true when the test-callback destructures `browserName` (unambiguous),
 *  OR destructures an ambiguous fixture (page/context/request) AND the file also
 *  calls a Playwright-exclusive matcher (corroboration). An ambiguous fixture
 *  alone never returns true — precision-first: it must not suppress a legitimate
 *  JS4 in a non-Playwright file (e.g. a supertest test taking `{ request }`). */
export function fileHasPlaywrightFixtureSignal(sf: ts.SourceFile): boolean {
  let strong = false, ambiguous = false, matcher = false;
  const readBinding = (obp: ts.ObjectBindingPattern): void => {
    for (const el of obp.elements) {
      const src = el.propertyName ?? el.name; // `{ page: p }` -> the source name `page`
      if (!ts.isIdentifier(src)) continue;
      if (PLAYWRIGHT_STRONG_FIXTURES.has(src.text)) strong = true;
      else if (PLAYWRIGHT_AMBIGUOUS_FIXTURES.has(src.text)) ambiguous = true;
    }
  };
  const visit = (node: ts.Node): void => {
    if (strong) return; // browserName alone is conclusive
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters.length > 0) {
      const p0 = node.parameters[0].name;
      if (ts.isObjectBindingPattern(p0)) readBinding(p0);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        PLAYWRIGHT_EXCLUSIVE_MATCHERS.has(node.expression.name.text)) matcher = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return strong || (ambiguous && matcher);
}
