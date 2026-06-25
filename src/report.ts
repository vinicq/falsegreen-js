/**
 * Output renderers and the baseline ratchet. Mirrors the Python sibling's
 * contract (SARIF 2.1.0, JUnit XML, content fingerprint) so the two scanners
 * produce interchangeable reports and a CI pipeline can swap one for the other.
 *
 * Divergence from falsegreen (Python): the js Finding carries no source snippet,
 * so the content fingerprint hashes relpath + code + detail only (Python also
 * folds in a normalized snippet). The fingerprint stays stable across unrelated
 * line shifts in both tools; the js id is just coarser when two findings share
 * the same code and detail in one file.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Finding } from "./types.js";
import { CASES, riskGroupOf, Confidence } from "./cases.js";

export type OutputFormat = "text" | "json" | "sarif" | "junit";

export const OUTPUT_EXT: Record<OutputFormat, string> = {
  text: "txt", json: "json", sarif: "sarif", junit: "xml",
};

/** A forward-slash relative URI (load-bearing for GitHub code scanning). */
export function relUri(file: string): string {
  let rel = file;
  try { rel = path.relative(process.cwd(), file); } catch { /* different drive on Windows */ }
  return rel.replace(/\\/g, "/");
}

/** SARIF level map: high -> error, low -> warning, off -> note. */
function sarifLevel(conf: Confidence): "error" | "warning" | "note" {
  if (conf === "high") return "error";
  if (conf === "low") return "warning";
  return "note";
}

function messageText(f: Finding): string {
  return CASES[f.code].title + (f.detail ? ` (${f.detail})` : "");
}

/**
 * SARIF 2.1.0 document. One rule per code present, one result per finding.
 * Levels come from the finding's effective confidence; result tags carry the
 * judgment, the risk group, and the level so GitHub code scanning can facet on
 * any of them.
 */
export function renderSarif(
  findings: Finding[],
  toolUri: string,
  version: string,
): string {
  const codes: string[] = [];
  for (const f of findings) if (!codes.includes(f.code)) codes.push(f.code);

  const rules = codes.map((code) => {
    const c = CASES[code];
    return {
      id: code,
      name: code,
      shortDescription: { text: c.title },
      defaultConfiguration: { level: sarifLevel(c.defaultOn ? c.severity : "off") },
      helpUri: toolUri,
      properties: { tags: [c.judgment] },
    };
  });

  const results = findings.map((f) => ({
    ruleId: f.code,
    level: sarifLevel(f.confidence),
    message: { text: messageText(f) },
    properties: {
      tags: [CASES[f.code].judgment, `risk:${riskGroupOf(f.code)}`, `level:${f.confidence}`],
    },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: relUri(f.file) },
        region: { startLine: f.line },
      },
    }],
  }));

  const doc = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "falsegreen-js", informationUri: toolUri, version, rules } },
      results,
    }],
  };
  return JSON.stringify(doc, null, 2);
}

/** XML attribute / text escaping for the JUnit renderer. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * JUnit XML. One testcase per finding, ordered by (file, line). A high-severity
 * finding is a <failure>; everything else is <skipped>. The suite attributes
 * count tests, failures (high), skipped (non-high), and errors (always 0).
 */
export function renderJunit(findings: Finding[]): string {
  const n = findings.length;
  const nHigh = findings.filter((f) => f.confidence === "high").length;
  const nNonHigh = n - nHigh;
  const suiteAttrs =
    `name="falsegreen-js" tests="${n}" failures="${nHigh}" skipped="${nNonHigh}" errors="0"`;

  const ordered = [...findings].sort(
    (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );

  const cases: string[] = [];
  for (const f of ordered) {
    const title = messageText(f);
    const loc = `${relUri(f.file)}:${f.line}`;
    const caseAttrs =
      `classname="falsegreen-js.${xmlEscape(f.code)}" name="${xmlEscape(`${f.code} ${loc}`)}"`;
    if (f.confidence === "high") {
      cases.push(
        `    <testcase ${caseAttrs}>\n` +
        `      <failure message="${xmlEscape(title)}">${xmlEscape(loc)}</failure>\n` +
        `    </testcase>`,
      );
    } else {
      cases.push(
        `    <testcase ${caseAttrs}>\n` +
        `      <skipped message="${xmlEscape(`${title}  ${loc}`)}"></skipped>\n` +
        `    </testcase>`,
      );
    }
  }

  const body = cases.length ? `\n${cases.join("\n")}\n  ` : "";
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<testsuites ${suiteAttrs}>\n` +
    `  <testsuite ${suiteAttrs}>${body}</testsuite>\n` +
    `</testsuites>`;
}

// ---------------------------------------------------------------------------
// Baseline (ratchet): fingerprint by content, not line number
// ---------------------------------------------------------------------------

/**
 * Stable id: sha1(relpath + "\0" + code + "\0" + detail)[:16]. No line number,
 * so the fingerprint survives unrelated line shifts in the file. The js
 * fingerprint omits the source snippet the Python tool folds in, since the js
 * Finding does not carry one.
 */
export function fingerprint(f: Finding): string {
  const key = [relUri(f.file), f.code, f.detail || ""].join("\0");
  return createHash("sha1").update(key, "utf-8").digest("hex").slice(0, 16);
}

/** Read a baseline file into a set of fingerprints (empty set if unreadable). */
export function loadBaseline(file: string): Set<string> {
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return new Set(); }
  const out = new Set<string>();
  const items = (data as { findings?: unknown }).findings;
  if (Array.isArray(items)) {
    for (const item of items) {
      const fp = (item as { fingerprint?: unknown }).fingerprint;
      if (typeof fp === "string" && fp) out.add(fp);
    }
  }
  return out;
}

/** Write all current findings as a baseline. Returns how many were recorded. */
export function writeBaseline(file: string, findings: Finding[]): number {
  const ordered = [...findings].sort(
    (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );
  const items = ordered.map((f) => ({
    fingerprint: fingerprint(f),
    code: f.code,
    file: relUri(f.file),
    detail: f.detail,
  }));
  const parent = path.dirname(file);
  if (parent) fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, tool: "falsegreen-js", findings: items }, null, 2) + "\n");
  return items.length;
}

/** Drop findings whose content fingerprint is already in the baseline. */
export function applyBaseline(findings: Finding[], baseline: Set<string>): Finding[] {
  return findings.filter((f) => !baseline.has(fingerprint(f)));
}
