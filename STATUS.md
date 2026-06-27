# Status

Public product state of `falsegreen-js` at a glance. For the full code catalog and usage,
see the [README](README.md); for the change history, see the [CHANGELOG](CHANGELOG.md).

Research artifacts, datasets, and unpublished numbers live in the private research hub,
never in this repo. This file tracks the public product only.

## Version

- Current: **0.4.0** (npm: `npm install -D falsegreen-js`)
- Versioning: semver; releases via trusted publishing (OIDC).

## CI health

- `ci.yml`: tests on Node 18 / 20 / 22.
- `release.yml`: npm publish on tag.
- `codex-review-gate.yml`, `release-drafter.yml`, `credit-contributor.yml`.

## Catalog coverage

Deterministic scan over the TypeScript compiler API (JS/TS/TSX/JSX/MTS/CTS). Active codes:

- **Shared with falsegreen (same concept, same id):** C2, C2b, C5, C6, C7, C8, C9, C16,
  C18, C20, C21, C23, C37, C44, C48, CC.
- **JS/TS ecosystem-specific:** JS1, JS2, JS3, JS4, JS5, JS6, JS7, JS8, JS9, JS11, JS13,
  JS15, JS17, JS18, JS21, JS22.
- **Diagnostic (opt-in, maintainability):** D1, D3, D4, D6, D7, D8.
- **Coupling (opt-in):** M2.
- **Project layer (`--config-audit`):** PL7, PL8, PL10.

Each code carries a judgment tag (J1-J6) and a risk family (F1-F8); see the README catalog
and the docs site for what each one flags, with a BAD plus CLEAN example.

## Supported runners and frameworks

Runner-agnostic: Jest, Vitest, Mocha + Chai, Jasmine, AVA, node:test, Cypress, Playwright,
and Testing Library. Detection is by code shape, not by a runner lock-in.

## Scope

Static layer only. Statically provable false-green with a low false-positive rate. Semantic
judgment goes to `falsegreen-skill`; runtime and culture are out of scope by design.
