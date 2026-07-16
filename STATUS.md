# Status

Public product state of `falsegreen-js` at a glance. For the full code catalog and usage,
see the [README](README.md); for the change history, see the [CHANGELOG](CHANGELOG.md).

Research artifacts, datasets, and unpublished numbers live in the private research hub,
never in this repo. This file tracks the public product only.

## Version

- Current: **0.7.0** (npm: `npm install -D falsegreen-js`)
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
  JS15, JS17, JS18, JS21, JS22, JS23, JS24, JS25, JS26, JS27, JS29, JS30, JS31, C8b, C11a.
- **Diagnostic (opt-in, maintainability):** D1, D3, D4, D6, D7, D8.
- **Coupling (opt-in):** M2.
- **Project layer (`--config-audit`):** PL7, PL8, PL10.

Each code carries a judgment tag (J1-J6) and a risk family (F1-F8); see the README catalog
and the docs site for what each one flags, with a BAD plus CLEAN example.

## Supported runners and frameworks

Runner-agnostic: Jest, Vitest, Mocha + Chai, Jasmine, AVA, node:test, Cypress, Playwright,
and Testing Library. Detection is by code shape, not by a runner lock-in.

Playwright covers both UI E2E and API specs. Its lifecycle hooks
(`test.beforeEach`/`afterEach`/`beforeAll`/`afterAll`), suite/step wrappers
(`test.describe`/`test.step`), and conditional `test.skip(cond)` are recognized
and not mistaken for a smell, whether `test`/`expect` are imported from
`@playwright/test` or from a fixture re-export (`test.extend`/`mergeTests`).

## Known observations (scope-future, not fixed here)

Two behaviors are documented deliberately rather than changed, so the decision is
on record:

- **C16 on `Date.now()`/`new Date()` used as test DATA** (a unique title, a
  relative future date) rather than as an oracle can read as a weak false
  positive. C16 is runner-agnostic and fires on any clock read; distinguishing
  "the time value reaches an assertion" from "it is only setup data" is a
  separate dataflow-aware refinement with its own precision trade-off, out of
  scope for the Playwright work. Tracked as a future issue.
- **JS31 in an `afterAll`/`afterEach` teardown hook.** Swallowing a `process.kill`
  or cleanup error in teardown is idiomatic and runs after the verdict is
  recorded, so it cannot cause a false-green - a weaker case to fire than the
  same pattern in a `beforeAll`/`beforeEach` setup hook, where a swallowed error
  hides a broken precondition. JS31 is currently file-wide and does not
  distinguish setup from teardown. Left as-is (parity with the accepted
  `global-setup.js` case); a setup-vs-teardown split is a separate, future scope.

## Scope

Static layer only. Statically provable false-green with a low false-positive rate. Semantic
judgment goes to `falsegreen-skill`; runtime and culture are out of scope by design.
