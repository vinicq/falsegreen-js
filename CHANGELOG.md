# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/vinicq/falsegreen-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vinicq/falsegreen-js/releases/tag/v0.1.0
