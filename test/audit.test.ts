import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditConfig } from "../src/audit.js";
import { CASES, FIX_HINTS } from "../src/cases.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-audit-"));
}
function codes(dir: string): string[] {
  return auditConfig(dir).map((f) => f.code).sort();
}

describe("config-audit (project-layer PL codes)", () => {
  it("flags PL7/PL8/PL10 on a bare package.json jest field", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "package.json"),
      JSON.stringify({ jest: { passWithNoTests: true, bail: 1 } }));
    expect(codes(dir)).toEqual(["PL10", "PL7", "PL8"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is clean when coverageThreshold is set and bail/passWithNoTests are off", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "package.json"),
      JSON.stringify({ jest: { coverageThreshold: { global: { lines: 80 } } } }));
    expect(codes(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads jest.config.json", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "jest.config.json"), JSON.stringify({ bail: true }));
    expect(codes(dir)).toEqual(["PL7", "PL8"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("AST-reads passWithNoTests from a jest.config.js", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "jest.config.js"),
      "module.exports = { passWithNoTests: true, coverageThreshold: { global: { lines: 90 } } };");
    expect(codes(dir)).toEqual(["PL10"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("AST-reads coverage thresholds from a vitest.config.ts (no PL7)", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "vitest.config.ts"),
      "export default { test: { coverage: { thresholds: { lines: 80 } } } };");
    expect(codes(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns nothing when there is no Jest/Vitest config", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "README.md"), "# nothing here");
    expect(codes(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("findings carry level project and a fix hint", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ jest: { bail: 1 } }));
    const pl8 = auditConfig(dir).find((f) => f.code === "PL8")!;
    expect(pl8.level).toEqual("project");
    expect(FIX_HINTS.PL8).toEqual("remove bail so the whole suite runs and the count is complete");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("every PL code is in the catalog and has a fix hint", () => {
    const pl = ["PL7", "PL8", "PL10"];
    expect(pl.filter((c) => c in CASES)).toEqual(pl);
    expect(pl.filter((c) => c in FIX_HINTS)).toEqual(pl);
  });
});
