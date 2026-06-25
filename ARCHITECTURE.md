# Architecture

falsegreen-js is a deterministic static scanner for JavaScript and TypeScript tests. It
reads test files, parses them with the TypeScript compiler API, and flags the structural
patterns that let a test pass without protecting anything. It never imports or runs the
code it scans.

## The pipeline

```
paths ──▶ discover ──▶ parse (ts.createSourceFile) ──▶ analyze ──▶ findings ──▶ report / exit code
```

The code mirrors that flow, one file per stage:

| File | Job |
|------|-----|
| `scan.ts` | discovery, config, suppression, exit-code logic |
| `parse.ts` | source text to a `ts.SourceFile`, with the right `ScriptKind` per extension |
| `rules.ts` | the visitor that walks the AST and emits findings |
| `cases.ts` | the case catalog, judgments, risk-group taxonomy, and confidence lookup |
| `oracles.ts` | the oracle registry: the assertion-API vocabulary as one versioned table |
| `types.ts` | the `Finding` shape |
| `cli.ts` | argument parsing and output |

1. **Discover.** Walk the paths. A file counts as a test when its extension is one of the
   eight JS/TS forms (`.js .jsx .ts .tsx .mjs .cjs .mts .cts`) and either its name matches a
   runner convention (`.test.`, `.spec.`, `.cy.`, `.e2e.`, `_test.`, Jasmine `...Spec.`) or
   it sits under a test directory (`__tests__`, `test`, `spec`, `cypress`, `e2e`). Vendored
   and build directories are skipped. `--staged` narrows to git-staged test files.
2. **Parse.** `ts.createSourceFile` with `setParentNodes` on, so a rule can walk up from a
   node. The `ScriptKind` is chosen per extension so JSX and TSX parse correctly. This is
   syntax only: no type-checker, no program, no module resolution, so the scan stays fast
   and runs without the project's `tsconfig` or `node_modules`.
3. **Analyze.** A single visitor pass. It recognizes assertion vocabulary across runners
   (Jest/Vitest `expect`, chai `.to`/`.should`, `assert*`, AVA `t.is`) so a Mocha or AVA
   test is not mistaken for one that checks nothing.
4. **Report.** Readable text or JSON (`--json`). The exit code is the CI contract.

## Output contract

| Exit | Meaning |
|------|---------|
| `0`  | clean |
| `10` | low-confidence findings only |
| `20` | at least one high-confidence finding |

Each finding carries code, confidence (`high`/`low`), file, line, judgment (J1-J6), and the
`riskGroup` it belongs to. The JSON report also keeps a legacy `group` field (the old
prefix grouping) for transition compatibility, and records the `oracleRegistryVersion` that
produced it. Confidence can be overridden per code through `.falsegreenrc.json`,
`falsegreen.json`, or a `falsegreen` key in `package.json`. An inline `// falsegreen: ignore`
(or `ignore[C8]`) silences a finding on its line.

## The case catalog and the risk-group taxonomy

`cases.ts` maps each code to four independent axes: `group` (the conceptual failure mode),
`severity` (`high`/`low`), `defaultOn` (whether the default scan emits it), and `judgment`
(J1-J6). Keeping them apart is deliberate: a code's taxonomy must not depend on whether it
blocks, and the blocking decision (the exit code) reads only the severity of the findings
that are actually emitted.

The primary grouping is the **risk-group taxonomy**, a closed set of six conceptual failure
modes read from the per-code table (`riskGroupOf`), never the code prefix:

| Risk group | What fails |
|------------|-----------|
| `effectiveness` | no oracle, a trivial oracle, or the wrong oracle (F1/F3/F4) |
| `execution` | the check exists but does not run, or the test vanishes from the count (F2/F5) |
| `nondeterminism` | passes or fails by luck: time, randomness, timers (F6) |
| `dependency` | real I/O or a stand-in for the unit under test: mystery guest, self-mock |
| `structure` | size and readability; the test still protects (F8 maintainability) |
| `diagnostic` | opt-in health signal, off by default |

An unknown code is rejected, not defaulted, so a code added to the rules but never
classified fails loudly. The legacy `group` (prefix-based `false-positive`/`diagnostic`/
`coupling`/`project`) survives only as a compatibility field on the JSON output.
`--diagnostics` turns the off-by-default `diagnostic` and `structure` codes into warnings.
Shared C-codes carry the same concept as the Python sibling (C2, C2b, C5, C7, C8, C16); the
`JS*` codes cover patterns specific to the JS/TS runners (focused tests, `expect` with no
matcher, floating async queries, snapshot-only assertions).

## The oracle registry

`oracles.ts` is the single, versioned source for the assertion-API vocabulary the scanner
understands. Each family is classified by how its failure reaches the runner: `sync-fail`
(throws synchronously, so a bare statement fails the test), `promise` (must be awaited or
returned to surface), `runner-registered` (the framework collects the outcome from a fluent
chain), and `value-only` (produces a value that must feed an assertion). `rules.ts` consults
this registry instead of carrying its own sets, and `ORACLE_REGISTRY_VERSION` is stamped
onto the JSON report. This table is the foundation for the planned split of the async rules.

## The boundary: static, semantic, runtime

The scanner owns what the AST proves. Outside that line:

- **Semantic** (the expected value contradicts the intended behavior; the test
  re-implements production logic) needs intent and belongs to
  [falsegreen-skill](https://github.com/vinicq/falsegreen-skill), the LLM pass.
- **Runtime** (order dependence, real-clock flakiness) needs execution, which the scanner
  does not do.

Precision over recall: a code that misses a case is preferred to one that flags correct
code. React production-code smells are out of scope on purpose: this is a test-file scanner.

## Siblings

[falsegreen](https://github.com/vinicq/falsegreen) (Python, `ast`, zero-dependency) and
[robotframework-falsegreen](https://github.com/vinicq/robotframework-falsegreen) (Robot Framework,
`robot.api`). Same false-green idea, different parser per language.
