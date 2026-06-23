import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "../src/parse.js";
import { detectPyramidLevel } from "../src/level.js";
import { scanFile } from "../src/scan.js";
import { CASES, FIX_HINTS } from "../src/cases.js";
import { makeFinding } from "../src/types.js";
import { pathToFileURL } from "node:url";
import { renderText, resolveOutputPath, isDirectRun } from "../src/cli.js";

function level(src: string, file = "x.test.ts"): string {
  return detectPyramidLevel(parse(file, src));
}

describe("pyramid level detection", () => {
  it("unit by default (no boundary imports)", () => {
    expect(level(`test("x", () => { expect(1).toBe(1); });`)).toBe("unit");
  });

  it("integration on an HTTP client import", () => {
    expect(level(`import request from "supertest";\ntest("x", () => {});`)).toBe("integration");
  });

  it("integration on a database driver import", () => {
    expect(level(`import { PrismaClient } from "@prisma/client";\ntest("x", () => {});`))
      .toBe("integration");
  });

  it("integration on a require() of a db driver", () => {
    expect(level(`const pg = require("pg");\ntest("x", () => {});`)).toBe("integration");
  });

  it("e2e on a browser/e2e framework import", () => {
    expect(level(`import { test } from "@playwright/test";\ntest("x", async () => {});`))
      .toBe("e2e");
  });

  it("e2e wins over integration when both are present", () => {
    expect(level(`import "cypress";\nimport axios from "axios";\ntest("x", () => {});`))
      .toBe("e2e");
  });

  it("relative imports do not raise the level", () => {
    expect(level(`import { f } from "./helper";\ntest("x", () => {});`)).toBe("unit");
  });
});

describe("scanFile attaches the file level to each finding", () => {
  it("marks findings in a supertest file as integration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-"));
    const file = path.join(dir, "api.test.ts");
    fs.writeFileSync(file, `import request from "supertest";\ntest("x", () => {});`);
    const findings = scanFile(file);
    fs.rmSync(dir, { recursive: true, force: true });
    // the empty test body is C2; assert it is present and carries the file level
    expect(findings.map((f) => f.code)).toContain("C2");
    expect([...new Set(findings.map((f) => f.level))]).toEqual(["integration"]);
  });
});

describe("fix hints", () => {
  it("every catalog code has a remediation hint", () => {
    const missing = Object.keys(CASES).filter((c) => !(c in FIX_HINTS));
    expect(missing).toEqual([]);
  });
});

describe("renderText status report", () => {
  const findings = [
    { ...makeFinding("a.test.ts", 1, "C5"), level: "integration" as const },
    { ...makeFinding("a.test.ts", 2, "C2b"), level: "integration" as const },
  ];

  it("shows the level and fix on each finding", () => {
    const out = renderText(findings);
    expect(out).toContain("level: integration");
    expect(out).toContain("fix:");
  });

  it("summarizes by level and lists top fixes", () => {
    const out = renderText(findings);
    expect(out).toContain("By level: integration:2");
    expect(out).toContain("Top fixes:");
    expect(out).toMatch(/C2b \(1\)|C5 \(1\)/);
  });
});

describe("resolveOutputPath", () => {
  it("treats an extension-less name as a directory and adds report.<ext>", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-out-"));
    const dest = resolveOutputPath(path.join(dir, ".falsegreen"), "json");
    expect(path.basename(dest)).toBe("report.json");
    expect(fs.existsSync(path.dirname(dest))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats a path with an extension as a single file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-out-"));
    const target = path.join(dir, "sub", "report.txt");
    const dest = resolveOutputPath(target, "text");
    expect(dest).toBe(target);
    expect(fs.existsSync(path.dirname(dest))).toBe(true); // parent created
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("isDirectRun (bin symlink guard)", () => {
  it("is false when there is no entry path", () => {
    expect(isDirectRun(undefined, "file:///x.js")).toBe(false);
  });

  it("matches the real file path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-run-"));
    const real = path.join(dir, "cli.js");
    fs.writeFileSync(real, "// entry");
    expect(isDirectRun(real, pathToFileURL(fs.realpathSync(real)).href)).toBe(true);
    expect(isDirectRun(real, "file:///somewhere/else.js")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a bin symlink to the real module URL (the regression)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-run-"));
    const real = path.join(dir, "cli.js");
    fs.writeFileSync(real, "// entry");
    const link = path.join(dir, "falsegreen-js");
    let supported = true;
    try { fs.symlinkSync(real, link); } catch { supported = false; } // Windows may forbid
    const moduleUrl = pathToFileURL(real).href;
    // argv[1] is the symlink while import.meta.url is the real path: realpath
    // resolution must still match. Where symlinks are unsupported, the raw path
    // matches directly, so the assertion runs unconditionally either way.
    const argv1 = supported ? link : real;
    expect(isDirectRun(argv1, moduleUrl)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
