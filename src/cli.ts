#!/usr/bin/env node
import { Finding } from "./types.js";
import { JUDGMENTS, CASES, groupOf } from "./cases.js";
import {
  scanPaths, scanFile, stagedFiles, loadConfig, ScanOptions,
} from "./scan.js";

const VERSION = "0.2.0";
const TOOL_URI = "https://github.com/vinicq/falsegreen-js";

const HELP = `falsegreen-js ${VERSION} - find false-positive JS/TS tests (static AST scan)

Usage:
  falsegreen-js [paths...]        files/dirs; no args = scan cwd
  falsegreen-js --staged          only test files staged in git
  falsegreen-js --json            JSON output
  falsegreen-js --diagnostics     also report the opt-in maintainability group (D*/M*)
  falsegreen-js --disable C7,JS3  turn off specific codes
  falsegreen-js --version
  falsegreen-js --help

Exit codes: 0 clean, 10 low-confidence only, 20 high-confidence present.
Suppress inline:  expect(x).toBe(x); // falsegreen: ignore[C7]
Covers: .js .jsx .ts .tsx .mjs .cjs .mts .cts`;

function parseArgs(argv: string[]) {
  const paths: string[] = [];
  let json = false, staged = false, help = false, version = false, diagnostics = false;
  const disable = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--staged") staged = true;
    else if (a === "--diagnostics") diagnostics = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--version" || a === "-V") version = true;
    else if (a === "--disable") {
      const v = argv[++i] ?? "";
      v.split(",").map((s) => s.trim()).filter(Boolean).forEach((c) => disable.add(c));
    } else if (a.startsWith("--disable=")) {
      a.slice("--disable=".length).split(",").map((s) => s.trim())
        .filter(Boolean).forEach((c) => disable.add(c));
    } else if (a.startsWith("-")) {
      process.stderr.write(`falsegreen-js: unknown option ${a}\n`);
      process.exit(2);
    } else paths.push(a);
  }
  return { paths, json, staged, help, version, diagnostics, disable };
}

function exitCode(findings: Finding[]): number {
  if (findings.some((f) => f.confidence === "high")) return 20;
  if (findings.some((f) => f.confidence === "low")) return 10;
  return 0;
}

function renderText(findings: Finding[]): string {
  if (findings.length === 0) return "falsegreen-js: no false-positive patterns found.";
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    (byFile.get(f.file) ?? byFile.set(f.file, []).get(f.file)!).push(f);
  }
  const lines: string[] = [];
  let high = 0, low = 0;
  for (const [file, fs_] of byFile) {
    lines.push(`\n${file}`);
    for (const f of fs_.sort((a, b) => a.line - b.line)) {
      const tag = f.confidence === "high" ? "HIGH" : "low ";
      if (f.confidence === "high") high++; else low++;
      lines.push(`  ${tag} ${f.code.padEnd(4)} L${f.line}  ${f.title}` +
        (f.detail ? `\n         ${f.detail}` : ""));
    }
  }
  lines.push(`\n${high} high, ${low} low. ${TOOL_URI}`);
  return lines.join("\n");
}

function main(): void {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { process.stdout.write(HELP + "\n"); process.exit(0); }
  if (opt.version) { process.stdout.write(VERSION + "\n"); process.exit(0); }

  const config = loadConfig();
  const scanOpts: ScanOptions = { config, cliDisable: opt.disable, diagnostics: opt.diagnostics };

  let findings: Finding[];
  if (opt.staged) {
    findings = stagedFiles().flatMap((f) => scanFile(f, scanOpts));
  } else {
    findings = scanPaths(opt.paths.length ? opt.paths : ["."], scanOpts);
  }

  if (opt.json) {
    process.stdout.write(JSON.stringify({
      tool: "falsegreen-js",
      version: VERSION,
      judgments: JUDGMENTS,
      findings: findings.map((f) => ({ ...f, group: groupOf(f.code) })),
    }, null, 2) + "\n");
  } else {
    process.stdout.write(renderText(findings) + "\n");
  }
  process.exit(exitCode(findings));
}

main();
