# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `C48` (dark patch): a test that flips a known test-mode flag into test mode and then
  asserts is exercising the product's test-only branch, not real behaviour. Detection-only;
  v1 covers raw writes (`process.env.NODE_ENV = "test"`, `process.env.TESTING = "1"`,
  `settings.TESTING = true`). `NODE_ENV` only counts as `"test"`; config values and product
  feature flags are not flagged; a flag write with no assertion after it is setup, not a dark
  patch. Parity with falsegreen (Python) `C48`, same id and J1/low (#39).

## [0.4.0] - 2026-06-27

### Fixed
- JS5 surfaces a floating promise observed only by a non-assignment binary op (||, &&, ===); only a real assignment with the call as RHS counts as observed.
- JS7 timer control now consults lifecycle hooks that install/flush fake timers at both the enclosing-describe and source-file top level (#41).


### Added
- C44 (numeric tautology, high, J2): `expect(x.length).toBeGreaterThanOrEqual(0)`. A
  `.length` is never negative and never NaN, so `>= 0` holds for every input and checks
  nothing — the JS/TS mirror of the Python `len(x) >= 0`. The subject must be a direct
  `.length` property access: a derived expression that only mentions `.length`
  (`a.length - b.length`) can be negative and is not flagged, and a bound that can still
  fail (`>= 1`, `> 0`) is a real check. Finiteness/NaN guards (`toBeLessThan(Infinity)`,
  `toBeGreaterThan(-Infinity)`) are deliberately not flagged: they are false for `NaN`, so
  they catch divide-by-zero and invalid-number bugs.
- Output-format parity with the Python scanner: `--format text|json|sarif|junit`
  (default `text`; `--json` stays as an alias for `--format json`). SARIF 2.1.0
  emits one rule per code and one result per finding, maps high to `error`, low to
  `warning`, off to `note`, and tags each result with its judgment, `risk:<group>`,
  and `level:<conf>`. JUnit XML turns high findings into `<failure>` and the rest
  into `<skipped>`. `--output` writes any of the four formats (sarif -> `.sarif`,
  junit -> `.xml`).
- Baseline ratchet: `--baseline [PATH]` suppresses findings already recorded (so CI
  fails only on net-new ones), and `--write-baseline [PATH]` records the current
  findings and exits 0. Both default to `.falsegreen-baseline.json`. A finding's
  identity is a content fingerprint (`sha1` of relative path + code + detail, no
  line number), stable across unrelated line shifts. The fingerprint omits the
  source snippet the Python scanner folds in, since the js `Finding` carries none.
- Risk-group taxonomy: every code now carries an explicit conceptual failure mode
  (`effectiveness`, `execution`, `nondeterminism`, `dependency`, `structure`,
  `diagnostic`), read from a closed per-code table (`riskGroupOf`) rather than the
  code prefix. An unknown code is rejected instead of defaulted. The JSON report
  gains a `riskGroup` field; the legacy `group` field stays for transition compatibility.
- A code's metadata is split into independent axes: `group` (taxonomy), `severity`
  (`high`/`low`), `defaultOn` (whether the default scan emits it), and `judgment`
  (J1-J6). The taxonomy no longer depends on whether a finding blocks.
- Oracle registry (`oracles.ts`): the assertion-API vocabulary is one versioned
  table, each family classified by how its failure reaches the runner (`sync-fail`,
  `promise`, `runner-registered`, `value-only`). The JSON report records the
  `oracleRegistryVersion` that classified it.

### Fixed
- `--version` and the JSON report's `version` field read from `package.json` at
  runtime; they were pinned to a stale `0.2.0` literal while the package was `0.3.0`.

## [0.3.0] - 2026-06-23

### Added
- New codes: JS21 (matcher referenced but never called, `expect(x).toBe` with no `()`),
  JS22 (empty `it.each`/`test.each` table), JS17 (commented-out test block), JS18 (`done`
  callback instead of async/await).
- supertest / chai-http `.expect()` is recognized as an assertion, so API integration tests
  built with `request(app).get(...).expect(200)` are no longer flagged C2b.
- Documented test-pyramid coverage: unit, integration (API and database), and E2E.
- `--config-audit` mode (project layer): reads the Jest/Vitest config (`package.json` `jest`
  field, `jest.config.*`, `vitest.config.*`; JSON directly, JS/TS via the TypeScript parser)
  and reports PL10 (`passWithNoTests`), PL7 (no `coverageThreshold` / `coverage.thresholds`),
  PL8 (`bail`). Findings carry level `project` and a fix hint. README now recommends Stryker
  for the mutation-testing layer the static scan cannot reach.
- Status report output: every finding now carries its pyramid level (unit / integration /
  e2e, detected from the file's import roots) and a one-line fix hint. The text summary adds
  a per-level breakdown and the top fixes by frequency; JSON gains `level` and `fix` fields.
- `--output` flag: write to a file, or pass a directory (e.g. `.falsegreen/`) to get
  `report.<ext>` for the chosen format. Parent directories are created as needed.

### Added
- Cross-language parity with the Python scanner: C6 (weak check — toBeTruthy/toBeDefined/length>0),
  C20 (assertion in dead code after return/throw), C23 (mystery guest — real file at a literal
  path / hard-coded URL), and JS8 (mocks the unit under test and asserts it directly).

### Added
- JS3 now covers visual snapshots (Playwright `toHaveScreenshot`/`toMatchScreenshot`): a test whose only check is a visual snapshot is snapshot-only (the baseline comes from the output). Percy `percySnapshot()`/`cy.percySnapshot()` is not a runtime assertion, so a percy-only test surfaces as no-assertion (C2b).

### Fixed
- Test-file discovery now matches more JS/TS naming conventions: Cypress `.cy.*`,
  Deno/Go `_test.*`, Jasmine `*Spec.*`, Angular/Protractor `.e2e-spec.*`, and `.e2e.*`
  (plus the `cypress`/`e2e` directories). Previously only `.test`/`.spec` were
  discovered, so Cypress/Deno/Jasmine/Angular specs were silently skipped.

### Added
- Vue/Svelte test-utils coverage: JS5 now flags non-awaited `flushPromises`/`nextTick`/
  `tick`; JS13 now flags Vue Test Utils `findComponent`/`findAllComponents` and
  `find`/`findAll` with a string selector used as a loose statement.

## [0.2.0] - 2026-06-22

### Added
- D8 (opt-in diagnostic): magic number in an assertion - a bare numeric literal as
  the expected value. The most frequent smell in LLM-generated tests (2410.10628).
- JS15: inappropriate assertion - the comparison is wrapped in a boolean
  (`expect(a === b).toBe(true)`), so the failure message is blind and the oracle
  weak. Sourced from the xNose "Inappropriate Assertions" smell (Paul et al., 2024).

## [0.1.0] - 2026-06-22

### Added

- Initial release. Deterministic AST scanner for false-green test smells in JS/TS.
- More false-green codes: C9 (broad `toThrow`), C37 (duplicate `it.each` case),
  JS13 (loose RTL query never asserted).
- Opt-in maintainability group (default off, enable with `--diagnostics` or config
  `severity`): D1 (assertion roulette), D3 (duplicate assert), D4 (`it.each` without
  titled cases), D6 (`console.*` in a test), D7 (anonymous test), M2 (long test body).
- Parser via the TypeScript compiler API, covering `.js`, `.jsx`, `.ts`, `.tsx`,
  `.mjs`, `.cjs`, `.mts`, `.cts`.
- Runner-agnostic assertion/test vocabulary: Jest, Vitest, Mocha + Chai, Jasmine, AVA,
  `node:test`, tap, Cypress, Playwright, Testing Library (jest-dom matchers).
- Detection codes:
  - Shared concept with `falsegreen` (Python): C2, C2b, C5, C7, C8, C16, CC.
  - Shared, additional: C18 (sensitive equality on a stringified value), C21 (every
    assertion is conditional).
  - JS/TS-specific: JS1 (focused test), JS2 (expect with no matcher), JS3 (snapshot-only),
    JS4 (skipped test), JS5 (async query/event not awaited), JS6 (empty describe),
    JS7 (assertion in a non-awaited timer/then callback), JS9 (assertion in a dead literal
    branch), JS11 (try/catch swallows the assertion).
- Custom assertion helpers (`assert*`/`expect*` naming, e.g. `util.assertEqual`) are
  recognized as assertions, reducing C2b false positives.
- CLI: paths, `--staged`, `--json`, `--disable`, `--version`, `--help`. Exit codes
  0/10/20. Inline suppression `// falsegreen: ignore[CODE]`. Config via `falsegreen.json`,
  `.falsegreenrc.json`, or a `falsegreen` key in `package.json`.
- pre-commit hook (`.pre-commit-hooks.yaml`), CI matrix (Node 18/20/22), and an npm
  trusted-publishing release workflow.

[Unreleased]: https://github.com/vinicq/falsegreen-js/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/vinicq/falsegreen-js/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vinicq/falsegreen-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vinicq/falsegreen-js/releases/tag/v0.1.0
