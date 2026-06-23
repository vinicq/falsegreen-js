# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New codes: JS21 (matcher referenced but never called, `expect(x).toBe` with no `()`),
  JS22 (empty `it.each`/`test.each` table), JS17 (commented-out test block), JS18 (`done`
  callback instead of async/await).
- supertest / chai-http `.expect()` is recognized as an assertion, so API integration tests
  built with `request(app).get(...).expect(200)` are no longer flagged C2b.
- Documented test-pyramid coverage: unit, integration (API and database), and E2E.

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

[Unreleased]: https://github.com/vinicq/falsegreen-js/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vinicq/falsegreen-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vinicq/falsegreen-js/releases/tag/v0.1.0
