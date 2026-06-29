import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanPaths } from "../src/scan.js";
import { parse } from "../src/parse.js";
import { analyze } from "../src/rules.js";

// Global output dedup contract (#64): scanPaths collapses true duplicates on
// (file, line, code, detail) but keeps two DIFFERENT codes on the same line.
// The key includes `code`, so distinct mechanisms co-firing on one line stay
// distinct (the adversarial case the contract protects).

function writeTest(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-dedup-"));
  fs.writeFileSync(path.join(dir, "x.test.ts"), src);
  return dir;
}

describe("global output dedup (file, line, code, detail)", () => {
  it("collapses a true duplicate to one finding", () => {
    // `expect(Date.now()).toBe(Date.now())` matches the C16 clock-read detector
    // on both Date.now() calls, so analyze emits C16 twice on the same line with
    // the same detail. The two passes are a true duplicate; dedup keeps one.
    const src = `test("t", () => {
  expect(Date.now()).toBe(Date.now());
});
`;
    const raw = analyze(parse("x.test.ts", src)).filter((f) => f.code === "C16");
    expect(raw.length).toBe(2); // pre-dedup: detector double-pushes
    const dir = writeTest(src);
    const deduped = scanPaths([dir]).filter((f) => f.code === "C16");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(deduped.length).toBe(1); // post-dedup: one finding
  });

  it("keeps two different codes on the same line (distinct mechanisms)", () => {
    // The dead assertion on line 4 reads the clock: C20 (unreachable) and C16
    // (non-determinism) are two distinct false-green mechanisms on one physical
    // line. The dedup key includes code, so both survive.
    const src =
      `test("t", () => {
  expect(1).toBe(1);
  return;
  expect(Date.now()).toBe(2);
});
`;
    const dir = writeTest(src);
    const onLine4 = new Set(scanPaths([dir]).filter((f) => f.line === 4).map((f) => f.code));
    fs.rmSync(dir, { recursive: true, force: true });
    expect(onLine4.has("C20")).toBe(true);
    expect(onLine4.has("C16")).toBe(true);
  });
});
