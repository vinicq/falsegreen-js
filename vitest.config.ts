import { defineConfig } from "vitest/config";

// The examples/ tree is a scan target, not a runnable suite: its *.test.ts and
// *.cy.ts files call helpers that do not exist on purpose, so vitest must not
// collect them. test/examples.test.ts loads them as text and scans them with
// analyze(parse(...)) instead. Everything under test/ runs as normal.
export default defineConfig({
  test: {
    exclude: ["examples/**", "node_modules/**", "dist/**"],
  },
});
