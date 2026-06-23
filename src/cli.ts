#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Finding } from "./types.js";
import { JUDGMENTS, CASES, groupOf, FIX_HINTS } from "./cases.js";
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
  falsegreen-js --output PATH     write to a file, or report.<ext> into a directory
  falsegreen-js --diagnostics     also report the opt-in maintainability group (D*/M*)
  falsegreen-js --disable C7,JS3  turn off specific codes
  falsegreen-js --version
  falsegreen-js --help

Each finding carries its pyramid level (unit/integration/e2e, read from imports)
and a one-line fix hint; the summary breaks findings down by level.
Exit codes: 0 clean, 10 low-confidence only, 20 high-confidence present.
Suppress inline:  expect(x).toBe(x); // falsegreen: ignore[C7]
Covers: .js .jsx .ts .tsx .mjs .cjs .mts .cts`;

function parseArgs(argv: string[]) {
  const paths: string[] = [];
  let json = false, staged = false, help = false, version = false, diagnostics = false;
  let output: string | undefined;
  const disable = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--staged") staged = true;
    else if (a === "--diagnostics") diagnostics = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--version" || a === "-V") version = true;
    else if (a === "--output") output = argv[++i] ?? "";
    else if (a.startsWith("--output=")) output = a.slice("--output=".length);
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
  return { paths, json, staged, help, version, diagnostics, disable, output };
}

/** Turn --output into a concrete file path. A directory (existing dir, a
 * trailing separator, or an extension-less name like ".falsegreen") receives
 * "report.<ext>" for the chosen format; anything else is treated as a file.
 * Missing parent directories are created either way. */
export function resolveOutputPath(p: string, fmt: "json" | "text"): string {
  const ext = fmt === "json" ? "json" : "txt";
  const trimmed = p.replace(/[/\\]+$/, "");
  const base = path.basename(trimmed);
  let isDir = /[/\\]$/.test(p) || path.extname(base) === "";
  try { if (fs.statSync(p).isDirectory()) isDir = true; } catch { /* missing path */ }
  if (isDir) {
    fs.mkdirSync(p, { recursive: true });
    return path.join(p, `report.${ext}`);
  }
  const parent = path.dirname(p);
  if (parent) fs.mkdirSync(parent, { recursive: true });
  return p;
}

function exitCode(findings: Finding[]): number {
  if (findings.some((f) => f.confidence === "high")) return 20;
  if (findings.some((f) => f.confidence === "low")) return 10;
  return 0;
}

export function renderText(findings: Finding[]): string {
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
      const hint = FIX_HINTS[f.code];
      lines.push(`         level: ${f.level}` + (hint ? `   fix: ${hint}` : ""));
    }
  }
  lines.push(`\n${high} high, ${low} low. ${TOOL_URI}`);

  // Test-pyramid breakdown + the most common fixes, over every finding shown.
  const byLevel = new Map<string, number>();
  const byCode = new Map<string, number>();
  for (const f of findings) {
    byLevel.set(f.level, (byLevel.get(f.level) ?? 0) + 1);
    byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  }
  const order = ["unit", "integration", "e2e"];
  const levels = [
    ...order.filter((l) => byLevel.has(l)),
    ...[...byLevel.keys()].filter((l) => !order.includes(l)).sort(),
  ];
  lines.push("By level: " + levels.map((l) => `${l}:${byLevel.get(l)}`).join(", "));
  const top = [...byCode.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  lines.push("Top fixes:");
  for (const [code, n] of top) {
    lines.push(`  ${code} (${n}): ${FIX_HINTS[code] ?? CASES[code].title}`);
  }
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

  const rendered = opt.json
    ? JSON.stringify({
        tool: "falsegreen-js",
        version: VERSION,
        judgments: JUDGMENTS,
        findings: findings.map((f) => ({
          ...f, group: groupOf(f.code), fix: FIX_HINTS[f.code] ?? "",
        })),
      }, null, 2)
    : renderText(findings);

  if (opt.output) {
    const dest = resolveOutputPath(opt.output, opt.json ? "json" : "text");
    fs.writeFileSync(dest, rendered + "\n");
  } else {
    process.stdout.write(rendered + "\n");
  }
  process.exit(exitCode(findings));
}

/** True when this module is the process entry point. Package managers expose the
 * `bin` through a symlink (node_modules/.bin/falsegreen-js), so process.argv[1]
 * is the symlink while import.meta.url is the real dist/cli.js path; resolve the
 * realpath before comparing, or `npx falsegreen-js` would exit without scanning. */
export function isDirectRun(invokedPath: string | undefined, moduleUrl: string): boolean {
  if (!invokedPath) return false;
  let resolved = invokedPath;
  try { resolved = fs.realpathSync(invokedPath); } catch { /* keep raw path */ }
  return moduleUrl === pathToFileURL(resolved).href;
}

// Run only when invoked as the CLI, so the module can be imported in tests
// without triggering a scan and process.exit.
if (isDirectRun(process.argv[1], import.meta.url)) {
  main();
}
