import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CASES, FIX_HINTS, baseConfidence, riskGroupOf, groupOf, RiskGroup,
} from "../src/cases.js";
import { ORACLE_REGISTRY_VERSION, oracleKind } from "../src/oracles.js";
import { buildReport } from "../src/cli.js";
import { makeFinding } from "../src/types.js";

const GROUPS: RiskGroup[] = [
  "effectiveness", "execution", "nondeterminism", "dependency", "structure", "diagnostic",
];

describe("risk-group taxonomy (closed per-code table)", () => {
  it("every catalog code maps to one of the six risk groups", () => {
    const unmapped = Object.keys(CASES).filter((code) => !GROUPS.includes(riskGroupOf(code)));
    expect(unmapped).toEqual([]);
  });

  it("rejects an unknown code instead of defaulting", () => {
    expect(() => riskGroupOf("NOPE")).toThrow(/unknown code/);
    expect(() => baseConfidence("NOPE")).toThrow(/unknown code/);
  });

  it("the group is driven by the table, not the prefix", () => {
    // Same C-prefix, three different conceptual failure modes.
    expect(riskGroupOf("C16")).toBe("nondeterminism");
    expect(riskGroupOf("C23")).toBe("dependency");
    expect(riskGroupOf("C2")).toBe("effectiveness");
    expect(riskGroupOf("C20")).toBe("execution");
    // Long Test is structure, not the legacy "coupling" name.
    expect(riskGroupOf("M2")).toBe("structure");
  });
});

describe("severity / default-state are separate axes", () => {
  it("default-on codes derive confidence from their severity", () => {
    expect(baseConfidence("C2")).toBe("high");   // severity high, on
    expect(baseConfidence("C2b")).toBe("low");   // severity low, on
  });

  it("the opt-in diagnostic group is off by default but keeps a severity", () => {
    const diag = ["D1", "D3", "D4", "D6", "D7", "D8", "M2"];
    expect(diag.filter((c) => CASES[c].defaultOn)).toEqual([]);          // all off by default
    expect(diag.filter((c) => baseConfidence(c) !== "off")).toEqual([]);  // confidence reflects it
    expect(diag.filter((c) => CASES[c].severity !== "low")).toEqual([]);  // severity survives while off
  });

  it("taxonomy does not change whether a code blocks", () => {
    // C2 and JS6 share severity+state but sit in the same group; C16 blocks-low
    // yet lives in a different group than C2b which also blocks-low.
    expect(riskGroupOf("C16")).not.toBe(riskGroupOf("C2b"));
    expect(baseConfidence("C16")).toBe(baseConfidence("C2b"));
  });
});

describe("legacy group field stays backward-compatible", () => {
  it("mirrors the pre-0.3 prefix grouping exactly", () => {
    expect(groupOf("C2")).toBe("false-positive");
    expect(groupOf("D1")).toBe("diagnostic");
    expect(groupOf("M2")).toBe("coupling");
    expect(groupOf("PL7")).toBe("project");
  });
});

describe("oracle registry", () => {
  it("exposes a version and classifies the core assertion families", () => {
    expect(ORACLE_REGISTRY_VERSION).toBeGreaterThanOrEqual(1);
    expect(oracleKind("expect")).toBe("sync-fail");
    expect(oracleKind("expect.resolves.toBe")).toBe("promise");
    expect(oracleKind("assert.equal")).toBe("sync-fail");
    expect(oracleKind("t.is")).toBe("runner-registered");
    expect(oracleKind("screen.findByText")).toBe("value-only");
    expect(oracleKind("waitFor")).toBe("promise");
    expect(oracleKind("flushPromises")).toBe("promise");
    expect(oracleKind("userEvent.click")).toBe("promise");
    expect(oracleKind("notAnOracle")).toBeNull();
  });
});

describe("JSON report shape", () => {
  const findings = [
    { ...makeFinding("a.test.ts", 1, "C16"), level: "unit" as const },
    { ...makeFinding("a.test.ts", 2, "C23"), level: "integration" as const },
  ];

  it("carries the primary riskGroup, the legacy group, and the registry version", () => {
    const r = buildReport(findings);
    expect(r.oracleRegistryVersion).toBe(ORACLE_REGISTRY_VERSION);
    expect(r.findings[0].riskGroup).toBe("nondeterminism");
    expect(r.findings[0].group).toBe("false-positive"); // legacy compat
    expect(r.findings[1].riskGroup).toBe("dependency");
    expect(r.findings[0].fix).toBe(FIX_HINTS.C16);
  });

  it("reports the version from package.json, not a hard-coded literal", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf-8"));
    expect(buildReport(findings).version).toBe(pkg.version);
  });
});
