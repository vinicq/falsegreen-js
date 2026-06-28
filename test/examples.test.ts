import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parse.js";
import { analyze } from "../src/rules.js";
import { CASES } from "../src/cases.js";

// Scan an examples file with the same pipeline the CLI uses (analyze on a parsed
// tree). analyze returns every finding, including the off-by-default diagnostic
// group, so a single pass covers default and opt-in codes. The wording in this
// file stays plain prose (it is itself self-scanned), never an assertion shape.
const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "..", "examples");

function scanExample(name: string): Set<string> {
  const file = path.join(examplesDir, name);
  const text = fs.readFileSync(file, "utf-8");
  return new Set(analyze(parse(file, text)).map((f) => f.code));
}

// Each examples file maps to the codes its BAD cases must trigger. The CLEAN
// look-alikes share the file; verification only requires presence, so a CLEAN
// case that stays quiet does not weaken the check.
const EXPECTED: Record<string, string[]> = {
  "effectiveness.test.ts": [
    "C2", "C2b", "C5", "C6", "C7", "C8", "C9", "C18", "C37", "C44", "JS3", "JS13", "JS15",
  ],
  "execution.test.ts": [
    "C20", "C21", "CC", "C48", "JS1", "JS2", "JS4", "JS5", "JS6", "JS7", "JS8",
    "JS9", "JS11", "JS17", "JS18", "JS21", "JS22", "JS23",
  ],
  "nondeterminism.test.ts": ["C16"],
  "dependency.test.ts": ["C23"],
  "cypress.cy.ts": ["JS24"],
  "diagnostics.test.ts": ["D1", "D3", "D4", "D6", "D7", "D8"],
};

describe("examples cover every emitted code", () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} triggers ${expected.join(", ")}`, () => {
      const found = scanExample(file);
      const missing = expected.filter((code) => !found.has(code));
      expect(missing).toEqual([]);
    });
  }

  it("the c16 fake-timers file stays free of C16 (frozen clock)", () => {
    // The whole-file fake-timer install suppresses C16: the look-alike is clean.
    const found = scanExample("c16-fake-timers.test.ts");
    expect(found.has("C16")).toBe(false);
  });

  it("every default-on emitted code has an examples case", () => {
    // Drift guard: the union of the per-file codes, plus the config-audit-only
    // PL series (which scan Jest/Vitest config, not test files), must cover the
    // full default-on catalog. A new default-on code added to cases.ts without
    // an examples case fails here.
    const covered = new Set<string>(Object.values(EXPECTED).flat());
    const configAuditOnly = new Set(["PL7", "PL8", "PL10"]);
    const missing = Object.keys(CASES).filter(
      (c) => CASES[c].defaultOn && !covered.has(c) && !configAuditOnly.has(c),
    );
    expect(missing).toEqual([]);
  });
});
