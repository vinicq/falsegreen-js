import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeFinding, Finding } from "../src/types.js";
import {
  renderSarif, renderJunit, fingerprint, loadBaseline, writeBaseline, applyBaseline,
} from "../src/report.js";
import { render } from "../src/cli.js";

const TOOL_URI = "https://github.com/vinicq/falsegreen-js";

// A fixed finding set spanning a high code, a self-compare high, and a low code,
// so the level map and the failure/skipped split are both exercised. Levels are
// pinned so the fixture does not depend on import detection.
function fixture(): Finding[] {
  return [
    { ...makeFinding("src/a.test.ts", 3, "C2", "test body is empty"), level: "unit" },
    { ...makeFinding("src/a.test.ts", 7, "C6", "only checks presence"), level: "unit" },
    { ...makeFinding("src/b.test.ts", 1, "C7"), level: "integration" },
  ];
}

describe("SARIF rendering", () => {
  const doc = JSON.parse(renderSarif(fixture(), TOOL_URI, "9.9.9"));
  const driver = doc.runs[0].tool.driver;
  const ruleIds = driver.rules.map((r: { id: string }) => r.id);
  const resultByCode = new Map<string, { level: string; tags: string[] }>();
  for (const r of doc.runs[0].results) {
    resultByCode.set(r.ruleId, { level: r.level, tags: r.properties.tags });
  }

  it("uses the SARIF 2.1.0 envelope and driver identity", () => {
    expect(doc.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(doc.version).toBe("2.1.0");
    expect(driver.name).toBe("falsegreen-js");
    expect(driver.informationUri).toBe(TOOL_URI);
    expect(driver.version).toBe("9.9.9");
  });

  it("emits one rule per code present, with a help URI", () => {
    expect(ruleIds).toEqual(["C2", "C6", "C7"]);
    expect(driver.rules[0].helpUri).toBe(TOOL_URI);
    expect(driver.rules[0].shortDescription.text).toBe("test with no check at all (empty body)");
  });

  it("maps confidence to SARIF level (high->error, low->warning)", () => {
    expect(resultByCode.get("C2")!.level).toBe("error");
    expect(resultByCode.get("C7")!.level).toBe("error");
    expect(resultByCode.get("C6")!.level).toBe("warning");
  });

  it("tags each result with judgment, risk group, and level", () => {
    expect(resultByCode.get("C2")!.tags).toEqual(["J1", "risk:effectiveness", "level:high"]);
    expect(resultByCode.get("C6")!.tags).toEqual(["J4", "risk:effectiveness", "level:low"]);
    expect(resultByCode.get("C7")!.tags).toEqual(["J2", "risk:effectiveness", "level:high"]);
  });

  it("puts the message detail in parentheses and a forward-slash relative URI", () => {
    const c2 = doc.runs[0].results[0];
    expect(c2.message.text).toBe("test with no check at all (empty body) (test body is empty)");
    expect(c2.locations[0].physicalLocation.artifactLocation.uri).toBe("src/a.test.ts");
    expect(c2.locations[0].physicalLocation.region.startLine).toBe(3);
  });
});

describe("JUnit rendering", () => {
  const xml = renderJunit(fixture());

  it("prefixes the XML declaration and counts tests, failures, and skipped", () => {
    expect(xml.startsWith(`<?xml version="1.0" encoding="utf-8"?>`)).toBe(true);
    expect(xml).toContain(`<testsuites name="falsegreen-js" tests="3" failures="2" skipped="1" errors="0">`);
  });

  it("renders a high finding as <failure> and a low finding as <skipped>", () => {
    const hasC2Failure = /<testcase classname="falsegreen-js\.C2"[^>]*>\s*<failure message="test with no check at all \(empty body\) \(test body is empty\)">src\/a\.test\.ts:3<\/failure>/.test(xml);
    const hasC6Skipped = /<testcase classname="falsegreen-js\.C6"[^>]*>\s*<skipped message="[^"]*src\/a\.test\.ts:7"><\/skipped>/.test(xml);
    expect(hasC2Failure).toBe(true);
    expect(hasC6Skipped).toBe(true);
  });

  it("orders testcases by (file, line)", () => {
    const order = [...xml.matchAll(/classname="falsegreen-js\.(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["C2", "C6", "C7"]);
  });
});

describe("content fingerprint", () => {
  it("is deterministic and 16 hex chars, independent of line number", () => {
    const a = { ...makeFinding("src/a.test.ts", 3, "C2", "test body is empty"), level: "unit" as const };
    const b = { ...makeFinding("src/a.test.ts", 99, "C2", "test body is empty"), level: "unit" as const };
    const fpA = fingerprint(a);
    expect(fpA).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint(b)).toBe(fpA);
  });

  it("changes when code or detail changes", () => {
    const base = { ...makeFinding("src/a.test.ts", 3, "C2", "x"), level: "unit" as const };
    const otherCode = { ...makeFinding("src/a.test.ts", 3, "C5", "x"), level: "unit" as const };
    const otherDetail = { ...makeFinding("src/a.test.ts", 3, "C2", "y"), level: "unit" as const };
    const distinct = new Set([fingerprint(base), fingerprint(otherCode), fingerprint(otherDetail)]);
    expect(distinct.size).toBe(3);
  });

  it("distinguishes same code+detail on different source lines by snippet", () => {
    // A fixed-detail code (C6) at two call sites with different source: distinct
    // fingerprints, so a net-new occurrence is not masked by a baselined one.
    const at10 = { ...makeFinding("src/a.test.ts", 10, "C6", "only checks presence"), level: "unit" as const, snippet: `expect(a).toBeDefined();` };
    const at55 = { ...makeFinding("src/a.test.ts", 55, "C6", "only checks presence"), level: "unit" as const, snippet: `expect(z).toBeDefined();` };
    expect(fingerprint(at10)).not.toBe(fingerprint(at55));
  });
});

describe("baseline ratchet", () => {
  it("write then read round-trips the fingerprints", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgjs-bl-"));
    const file = path.join(dir, "bl.json");
    const findings = fixture();
    const n = writeBaseline(file, findings);
    const loaded = loadBaseline(file);
    const expected = new Set(findings.map((f) => fingerprint(f)));
    fs.rmSync(dir, { recursive: true, force: true });
    expect(n).toBe(3);
    expect(loaded).toEqual(expected);
  });

  it("suppresses known findings and keeps new ones", () => {
    const known = fixture();
    const baseline = new Set(known.map((f) => fingerprint(f)));
    const newer = { ...makeFinding("src/c.test.ts", 5, "C5", "always true"), level: "unit" as const };
    const filtered = applyBaseline([...known, newer], baseline);
    expect(filtered.map((f) => f.code)).toEqual(["C5"]);
  });

  it("keeps a net-new occurrence of a fixed-detail code and suppresses the shifted one", () => {
    // Acceptance (#88 item 2): baseline has C6 with snippet S1 (was L10). New
    // scan: same C6 shifted to L12 (still snippet S1) + a net-new C6 at L55
    // (snippet S2). Only the L55 one survives applyBaseline.
    const baselined = { ...makeFinding("src/a.test.ts", 10, "C6", "only checks presence"), level: "unit" as const, snippet: `expect(a).toBeDefined();` };
    const baseline = new Set([fingerprint(baselined)]);
    const shifted = { ...makeFinding("src/a.test.ts", 12, "C6", "only checks presence"), level: "unit" as const, snippet: `expect(a).toBeDefined();` };
    const netNew = { ...makeFinding("src/a.test.ts", 55, "C6", "only checks presence"), level: "unit" as const, snippet: `expect(z).toBeDefined();` };
    const filtered = applyBaseline([shifted, netNew], baseline);
    expect(filtered.map((f) => f.line)).toEqual([55]);
  });

  it("returns an empty set for an unreadable baseline file", () => {
    const empty = loadBaseline(path.join(os.tmpdir(), "fgjs-does-not-exist-12345.json"));
    expect(empty.size).toBe(0);
  });
});

describe("render dispatcher keeps --format json identical", () => {
  it("renders JSON with the full report fields unchanged", () => {
    const findings = fixture();
    const out = JSON.parse(render(findings, "json"));
    expect(out.tool).toBe("falsegreen-js");
    expect(out.oracleRegistryVersion).toBe(2);
    expect(Object.keys(out.judgments).sort()).toEqual(["J1", "J2", "J3", "J4", "J5", "J6"]);
    const first = out.findings[0];
    expect(first.code).toBe("C2");
    expect(first.riskGroup).toBe("effectiveness");
    expect(first.group).toBe("false-positive");
    expect(first.fix).toBe("add an assertion that checks the behaviour under test");
    expect(first.level).toBe("unit");
  });
});
