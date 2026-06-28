#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Finding } from "./types.js";
import { JUDGMENTS, CASES, groupOf, riskGroupOf, FIX_HINTS } from "./cases.js";
import { ORACLE_REGISTRY_VERSION } from "./oracles.js";
import {
  scanPaths, scanFile, stagedFiles, loadConfig, ScanOptions,
} from "./scan.js";
import { auditConfig } from "./audit.js";
import {
  OutputFormat, OUTPUT_EXT, renderSarif, renderJunit,
  loadBaseline, writeBaseline, applyBaseline,
} from "./report.js";

const DEFAULT_BASELINE = ".falsegreen-baseline.json";

/** Single source of truth for the version: package.json, resolved at runtime so
 * `--version` and the JSON report never drift from the published package. */
function readVersion(): string {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = readVersion();
const TOOL_URI = "https://github.com/vinicq/falsegreen-js";

const HELP = `falsegreen-js ${VERSION} - find false-positive JS/TS tests (static AST scan)

Usage:
  falsegreen-js [paths...]        files/dirs; no args = scan cwd
  falsegreen-js --staged          only test files staged in git
  falsegreen-js --format FMT      text | json | sarif | junit (default text)
  falsegreen-js --json            alias for --format json
  falsegreen-js --output PATH     write to a file, or report.<ext> into a directory
  falsegreen-js --baseline [PATH] suppress findings in PATH (default ${DEFAULT_BASELINE})
  falsegreen-js --write-baseline [PATH]  record current findings as a baseline, exit 0
  falsegreen-js --config-audit    audit Jest/Vitest config (project-layer PL codes)
  falsegreen-js --diagnostics     also report the opt-in maintainability group (D*/M*)
  falsegreen-js --disable C7,JS3  turn off specific codes
  falsegreen-js --enable D8,M2    re-activate off/opt-in codes at catalog severity (--disable wins)
  falsegreen-js --version
  falsegreen-js --help

Each finding carries its pyramid level (unit/integration/e2e, read from imports)
and a one-line fix hint; the summary breaks findings down by level.
Exit codes: 0 clean, 10 low-confidence only, 20 high-confidence present.
Suppress inline:  expect(x).toBe(x); // falsegreen: ignore[C7]
Covers: .js .jsx .ts .tsx .mjs .cjs .mts .cts`;

const FORMATS = new Set<OutputFormat>(["text", "json", "sarif", "junit"]);

function parseArgs(argv: string[]) {
  const paths: string[] = [];
  let json = false, staged = false, help = false, version = false, diagnostics = false;
  let configAudit = false;
  let format: OutputFormat | undefined;
  let output: string | undefined;
  let baseline: string | undefined;
  let writeBaselinePath: string | undefined;
  const disable = new Set<string>();
  const enable = new Set<string>();
  // An optional-value flag (--baseline / --write-baseline) consumes the next
  // token only when it is a value, not another flag.
  const optionalValue = (next: string | undefined): string | undefined =>
    (next !== undefined && !next.startsWith("-")) ? next : undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--staged") staged = true;
    else if (a === "--config-audit") configAudit = true;
    else if (a === "--diagnostics") diagnostics = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--version" || a === "-V") version = true;
    else if (a === "--format") {
      const v = argv[++i] ?? "";
      if (!FORMATS.has(v as OutputFormat)) {
        process.stderr.write(`falsegreen-js: invalid --format ${v} (text|json|sarif|junit)\n`);
        process.exit(2);
      }
      format = v as OutputFormat;
    } else if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      if (!FORMATS.has(v as OutputFormat)) {
        process.stderr.write(`falsegreen-js: invalid --format ${v} (text|json|sarif|junit)\n`);
        process.exit(2);
      }
      format = v as OutputFormat;
    } else if (a === "--output") output = argv[++i] ?? "";
    else if (a.startsWith("--output=")) output = a.slice("--output=".length);
    else if (a === "--baseline") {
      const v = optionalValue(argv[i + 1]); if (v !== undefined) i++;
      baseline = v ?? DEFAULT_BASELINE;
    } else if (a.startsWith("--baseline=")) {
      baseline = a.slice("--baseline=".length) || DEFAULT_BASELINE;
    } else if (a === "--write-baseline") {
      const v = optionalValue(argv[i + 1]); if (v !== undefined) i++;
      writeBaselinePath = v ?? DEFAULT_BASELINE;
    } else if (a.startsWith("--write-baseline=")) {
      writeBaselinePath = a.slice("--write-baseline=".length) || DEFAULT_BASELINE;
    } else if (a === "--disable") {
      const v = argv[++i] ?? "";
      v.split(",").map((s) => s.trim()).filter(Boolean).forEach((c) => disable.add(c));
    } else if (a.startsWith("--disable=")) {
      a.slice("--disable=".length).split(",").map((s) => s.trim())
        .filter(Boolean).forEach((c) => disable.add(c));
    } else if (a === "--enable") {
      const v = argv[++i] ?? "";
      v.split(",").map((s) => s.trim()).filter(Boolean).forEach((c) => enable.add(c));
    } else if (a.startsWith("--enable=")) {
      a.slice("--enable=".length).split(",").map((s) => s.trim())
        .filter(Boolean).forEach((c) => enable.add(c));
    } else if (a.startsWith("-")) {
      process.stderr.write(`falsegreen-js: unknown option ${a}\n`);
      process.exit(2);
    } else paths.push(a);
  }
  const fmt: OutputFormat = format ?? (json ? "json" : "text");
  return {
    paths, fmt, staged, help, version, diagnostics, configAudit, disable, enable,
    output, baseline, writeBaselinePath,
  };
}

/** Turn --output into a concrete file path. A directory (existing dir, a
 * trailing separator, or an extension-less name like ".falsegreen") receives
 * "report.<ext>" for the chosen format; anything else is treated as a file.
 * Missing parent directories are created either way. */
export function resolveOutputPath(p: string, fmt: OutputFormat): string {
  const ext = OUTPUT_EXT[fmt];
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

/** The JSON report object. Each finding carries both the primary `riskGroup`
 * (closed taxonomy) and the legacy `group` (transition-compat), plus its fix
 * hint. The tool block records the oracle-registry version that classified it. */
export function buildReport(findings: Finding[]) {
  return {
    tool: "falsegreen-js",
    version: VERSION,
    oracleRegistryVersion: ORACLE_REGISTRY_VERSION,
    judgments: JUDGMENTS,
    findings: findings.map((f) => ({
      ...f,
      riskGroup: riskGroupOf(f.code),
      group: groupOf(f.code),
      fix: FIX_HINTS[f.code] ?? "",
    })),
  };
}

/** Render findings in the chosen format. JSON keeps the full report object
 * (riskGroup/group/fix/oracleRegistryVersion/judgments); SARIF/JUnit follow the
 * Python sibling's contract. */
export function render(findings: Finding[], fmt: OutputFormat): string {
  if (fmt === "json") return JSON.stringify(buildReport(findings), null, 2);
  if (fmt === "sarif") return renderSarif(findings, TOOL_URI, VERSION);
  if (fmt === "junit") return renderJunit(findings);
  return renderText(findings);
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

function scan(opt: ReturnType<typeof parseArgs>): Finding[] {
  const config = loadConfig();
  const scanOpts: ScanOptions = {
    config, cliDisable: opt.disable, cliEnable: opt.enable, diagnostics: opt.diagnostics,
  };
  if (opt.staged) return stagedFiles().flatMap((f) => scanFile(f, scanOpts));
  return scanPaths(opt.paths.length ? opt.paths : ["."], scanOpts);
}

function emit(rendered: string, opt: ReturnType<typeof parseArgs>): void {
  if (opt.output) fs.writeFileSync(resolveOutputPath(opt.output, opt.fmt), rendered + "\n");
  else process.stdout.write(rendered + "\n");
}

function main(): void {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { process.stdout.write(HELP + "\n"); process.exit(0); }
  if (opt.version) { process.stdout.write(VERSION + "\n"); process.exit(0); }

  // --write-baseline records the current scan and exits clean, ahead of every
  // other mode (mirrors the Python sibling: it ratchets the file scan only).
  if (opt.writeBaselinePath !== undefined) {
    const n = writeBaseline(opt.writeBaselinePath, scan(opt));
    process.stderr.write(`falsegreen-js: wrote ${n} fingerprint(s) to ${opt.writeBaselinePath}\n`);
    process.exit(0);
  }

  if (opt.configAudit) {
    const base = opt.paths.find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) ?? ".";
    const findings = auditConfig(base);
    emit(render(findings, opt.fmt), opt);
    process.exit(findings.length ? 10 : 0);
  }

  let findings = scan(opt);

  // The baseline filter runs before the exit code, so CI fails only on findings
  // that are not already recorded.
  if (opt.baseline !== undefined) {
    findings = applyBaseline(findings, loadBaseline(opt.baseline));
  }

  emit(render(findings, opt.fmt), opt);
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
