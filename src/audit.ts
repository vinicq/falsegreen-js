import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { Finding, makeFinding } from "./types.js";
import { parse } from "./parse.js";

// Project-layer audit (--config-audit): the suite goes green by configuration,
// not by a smell inside any one test file. Reads the Jest/Vitest config.

interface ConfigSignals {
  where: string;
  passWithNoTests: boolean;
  bail: boolean;
  hasCovGate: boolean;
}

/** JSON config: package.json `jest` field, or jest.config.json. */
function readJsonConfig(start: string): { path: string; cfg: Record<string, unknown> } | null {
  const pkg = path.join(start, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkg, "utf-8"));
      if (j && typeof j.jest === "object") return { path: pkg, cfg: j.jest };
    } catch { /* unreadable */ }
  }
  const jcj = path.join(start, "jest.config.json");
  if (fs.existsSync(jcj)) {
    try { return { path: jcj, cfg: JSON.parse(fs.readFileSync(jcj, "utf-8")) }; } catch { /* unreadable */ }
  }
  return null;
}

/** JS/TS config (jest.config.*, vitest.config.*, vite.config.*): AST-walk for
 * the property assignments of interest. A heuristic, not full evaluation. */
function readAstConfig(start: string):
  { path: string; props: Set<string>; passWithNoTests: boolean; bail: boolean } | null {
  const candidates = [
    "jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.cjs",
    "vitest.config.ts", "vitest.config.js", "vitest.config.mts",
    "vite.config.ts", "vite.config.js",
  ];
  for (const name of candidates) {
    const p = path.join(start, name);
    if (!fs.existsSync(p)) continue;
    let text: string;
    try { text = fs.readFileSync(p, "utf-8"); } catch { continue; }
    const sf = parse(p, text);
    const props = new Set<string>();
    let passWithNoTests = false;
    let bail = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
        const key = node.name.text;
        props.add(key);
        const init = node.initializer;
        if (key === "passWithNoTests" && init.kind === ts.SyntaxKind.TrueKeyword) {
          passWithNoTests = true;
        }
        if (key === "bail") {
          if (init.kind === ts.SyntaxKind.TrueKeyword) bail = true;
          else if (ts.isNumericLiteral(init) && Number(init.text) > 0) bail = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return { path: p, props, passWithNoTests, bail };
  }
  return null;
}

function collect(start: string): ConfigSignals | null {
  const json = readJsonConfig(start);
  const ast = readAstConfig(start);
  if (!json && !ast) return null;
  let passWithNoTests = false;
  let bail = false;
  let hasCovGate = false;
  if (json) {
    const c = json.cfg as Record<string, unknown>;
    if (c.passWithNoTests === true) passWithNoTests = true;
    if (c.bail === true || (typeof c.bail === "number" && c.bail > 0)) bail = true;
    const cov = c.coverage as Record<string, unknown> | undefined;
    if (c.coverageThreshold || c.thresholds || (cov && cov.thresholds)) hasCovGate = true;
  }
  if (ast) {
    if (ast.passWithNoTests) passWithNoTests = true;
    if (ast.bail) bail = true;
    if (ast.props.has("coverageThreshold") || ast.props.has("thresholds")) hasCovGate = true;
  }
  return { where: json?.path ?? ast!.path, passWithNoTests, bail, hasCovGate };
}

/** Read the Jest/Vitest config and report the project-layer PL codes: ways the
 * suite can report green by configuration. Findings carry level `project`.
 * Returns [] when no Jest/Vitest config is found. */
export function auditConfig(start: string = process.cwd()): Finding[] {
  const sig = collect(start);
  if (!sig) return [];
  const findings: Finding[] = [];
  const mk = (code: string): Finding => {
    const f = makeFinding(sig.where, 1, code);
    f.level = "project";
    return f;
  };
  if (!sig.hasCovGate) findings.push(mk("PL7"));
  if (sig.bail) findings.push(mk("PL8"));
  if (sig.passWithNoTests) findings.push(mk("PL10"));
  return findings;
}
