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
