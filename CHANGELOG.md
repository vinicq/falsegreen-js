# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.2] - 2026-06-29

### Fixed

- Global output dedup (#64): `scanPaths` now collapses identical findings on
  `(file, line, code, detail)` before emitting, matching the Python reference
  scanner. A detector that pushes the same finding twice (an overlapping pass on
  one line) surfaced as a duplicate before; now it appears once. Two different
  codes on the same line both survive, since the key includes the code: distinct
  false-green mechanisms on one line stay distinct.
- Hardened the dead-assertion threading (#64, L11): the dead set computed by C20
  now feeds every reader of those assertions through one `liveAssertion`
  predicate plus the spine walk, so a future reader cannot read a dead assertion
  as live and suppress C21 by mistake (the js #62 class of bug).

## [0.6.1] - 2026-06-29

### Fixed
- Field validation (#82) tightened six codes shipped in 0.6.0 that over-fired on
  real-world tests:
  - `JS30` no longer flags the `expect(true).toBe(false)` force-fail shape inside a
    `try` whose `catch` asserts on the error (the "should not reach here" idiom), an
    inner literal-vs-literal expect that is the subject of an enclosing matcher
    (`expect(() => expect(1).toBe(2)).toThrow()`), or a literal-vs-literal expect in
    a skipped block or dead code (JS4 and C20 already own those).
  - `JS31` no longer fires when the enclosing test has an unconditional assertion
    outside the `try`, so an incidental-IO `try/catch` (a `fs.writeFileSync` or page
    setup) next to a real oracle stays clean.
  - `JS25` now recognises an iterator receiver bound to a non-empty array literal
    (`const cases = [1, 2, 3]; cases.forEach(...)`), not only an inline literal, so a
    loop that provably runs is no longer flagged.
  - `JS27` treats `toHaveBeenCalledWith`/`toHaveBeenLastCalledWith`/
    `toHaveBeenNthCalledWith`/`toBeCalledWith` carrying a non-empty argument list as a
    behavioral oracle, not a weak call-counter. The arg-less `toHaveBeenCalled`/
    `toHaveBeenCalledTimes` family (and an arg-less `*With`) stays weak.
  - `C16` no longer reports a fixed `setTimeout(_, <literal>)` delay: a constant delay
    is deterministic, and the unflushed-callback concern is owned by JS7 and JS26.
  - `C21` treats a literal-bounded `for` loop (`for (let i = 0; i < 3; i++)`) and a
    `for...of` over a non-empty array literal as unconditional, since the body
    provably runs at least once.

## [0.6.0] - 2026-06-29


### Added
- `JS25` (high, J1): the only assertion sits inside an array-iterator callback
  (`forEach`/`map`/`filter`/`some`/`every`/`flatMap`). On an empty collection the
  callback runs zero times, so nothing is checked and the test still goes green.
  Fills the verified gap between C2/C2b (whose `hasAssertion` descends into the
  callback and finds the assertion) and C21 (whose own-scope scan stops at the
  callback and sees none). FP guards: an own-scope assertion, a non-empty
  array-literal receiver, or an `expect.assertions`/`hasAssertions` guard suppress it.
- `JS30` (high, J2): literal-vs-literal assertion such as `expect(2).toBe(3)` or
  chai `expect(x).to.equal(y)`, where both operands are literal nodes through an
  equality matcher (`toBe`/`toEqual`/`toStrictEqual`/`toBeCloseTo`/`equal`/`equals`/
  `eql`/`is`). The comparison is fixed at parse time, independent of any code. The
  same-token case (`expect(1).toBe(1)`) stays with C5; object/array literals
  (reference equality) and template literals with substitutions are excluded.
- `JS31` (low, J1): a `try/catch` whose try calls code that may throw and whose
  catch neither asserts on the exception, re-raises, nor calls `fail()`. A unit that
  stops throwing (a real regression) still passes green. Complement of JS11, which
  owns the swallowed-assertion case; JS31 fires only when the try has a call but no
  assertion and the catch is harmless.
- `JS27` (low, J3): `toHaveBeenCalled*` is the sole oracle on a locally-created
  double (`jest.fn`/`vi.fn`/`spyOn`). The test confirms it called the double it set
  up, not the unit's output or state. Gated to the unit level (a logger-spy call
  check is legitimate at integration/e2e) and suppressed when any non-call-tracking
  assertion is present. Sibling of JS8.
- `JS26` (low, J1): fake timers installed but never advanced. A `setTimeout`/
  `setInterval` is armed under frozen fake timers and nothing in the test scope (nor
  a sibling `before`/`after` hook) calls `runAllTimers`/`advanceTimersByTime`/`tick`,
  so the scheduled callback never fires and the assertion reads un-mutated state. The
  opposite of C16 (uncontrolled timer). Requires an assertion in scope; a flush in
  the body or an enclosing hook suppresses it.
- `JS29` (low, J6): an `expect(...).resolves`/`.rejects` chain that is a bare
  statement, not awaited or returned. The matcher settles asynchronously, so a
  floating chain finishes green before it resolves. The statically-provable subset of
  the skipped JS20, keyed on the explicit `.resolves`/`.rejects` marker so no type
  inference is needed.
- `C8b` (low, J4): `toBeCloseTo` called with no precision argument, so the default
  2-digit tolerance applies. The js analogue of `assertAlmostEqual`/`pytest.approx`
  with no tolerance, ported from `falsegreen`. Implicit-precision only; a
  literal-vs-literal `toBeCloseTo` stays with JS30.
- `C11a` (low, J2): self-confirming literal. The expected value is bound from the
  same call under test (`const e = foo(); expect(foo()).toBe(e)`), so the oracle
  confirms the code against itself. Ported from `falsegreen`; the bound initializer
  must provably be the SUT call (its source text equals the expect subject's), so a
  literal or a different-call binding stays clean.

### Changed
- `C8` (exact float) now fires only when the subject is a real (non-literal) value;
  a literal-vs-literal float (`expect(0.1).toBe(0.3)`) is owned by the stronger JS30
  lane, so the two no longer double-report.

## [0.5.0] - 2026-06-28

### Added
- `JS23` (high, J1): `expect.assertions(N)` with a numeric `N` higher than the unconditional,
  reachable, non-nested `expect()` calls that can run. The guard can never be met, so the test
  passes without ever exercising the count it claims. Fires only when `N` is a numeric literal
  and the shortfall is provable: an `expect` in a loop, a branch, a `.then`/callback, or a
  helper makes the count indeterminate and suppresses the finding. `expect.hasAssertions()`
  carries no count and is skipped. This is the implemented sibling of the still-skipped JS16.
- `JS24` (low, J4): a Cypress query chain (`cy.get`/`cy.find`/`cy.contains`) used as a statement
  with no terminating `.should`/`.and` and no `expect` inside a `.then` callback. The query
  produces a subject that is never asserted, the cy.* analogue of JS13. Action commands
  (`click`/`type`/`visit`/...) do work rather than just query, so a chain ending in one stays
  clean, as does a chain that ends in `.should`/`.and` or asserts in `.then`.
- CLI `--enable <codes>` (and `--enable=...`): re-activates listed off or opt-in codes at their
  catalog severity, flipping a default-off code on. It cannot raise a code above catalog
  severity. `--disable` wins over `--enable`, so a code passed to both stays off.
- `examples/` tree (#47): a worked sample for every emitted code, a BAD test the scanner flags
  paired with a CLEAN look-alike one token away that it leaves alone. Files are grouped by
  RiskGroup (`effectiveness`, `execution`, `nondeterminism`, `dependency`), with `cypress.cy.ts`
  for the Cypress code and `diagnostics.test.ts` for the opt-in maintainability group. C16 keeps
  a separate frozen-clock file because the fake-timer signal is file-wide. `vitest.config.ts`
  excludes `examples/**` from collection, and `test/examples.test.ts` scans each file with
  `analyze(parse(...))` to assert every code fires in its file, with a drift guard that fails if a
  new default-on code lands without an example. The config-audit-only PL series scans Jest/Vitest
  config rather than a test file, so it has no test-file example.

### Changed
- `JS8` now also catches the `jest.spyOn`/`vi.spyOn` form: a spy with a canned return
  (`mockReturnValue`/`mockResolvedValue`/`mockImplementation`) whose spied target root is also an
  `expect` subject. The test asserts the canned value, not real behaviour. Conservative
  same-binding guard: spying a collaborator (a different object) stays clean, and asserting on
  the spy handle itself (`expect(spy).toHaveBeenCalled()`) is not treated as the subject.
- `JS3` gains a distinct detail when the snapshot is an empty inline baseline:
  `toMatchInlineSnapshot()` with no argument, or an empty or whitespace-only string baseline,
  passes by writing itself on the first run. A populated inline snapshot keeps the existing
  detail; the snapshot-only detection logic is unchanged.

### Docs
- `CONTRIBUTING.md` documents the FP-boundary decisions that previously lived only in
  source comments: the admission criteria for a new code (statically provable, FP-guarded,
  ships with a CLEAN look-alike one token from the BAD, carries a catalog entry, clears the
  panel and principal-reviewer gate) and the standing per-code rules for C44, C6, JS5, C16,
  JS23, JS24, and JS8 (#51).

## [0.4.0] - 2026-06-28

### Fixed
- C21 no longer false-positives on a `do { expect } while(c)`: a do/while body always runs at least
  once, so its assertion is unconditional (#60).
- C16 crypto match is anchored to a crypto root (`crypto.randomUUID`, `globalThis/window/self.crypto`,
  or the bare node:crypto import), so a user method named `randomUUID()`/`getRandomValues()` is no
  longer flagged (#61).
- C20 and C21 no longer double-report on a dead-code-only assertion: an assertion already flagged
  C20 (unreachable) is excluded from the C21 set, so C20 owns the line. C21 still fires when a live
  conditional assertion remains (#62).

### Added
- `C16` nondeterminism now also flags `new Date()` (zero-arg, reads the system clock),
  `crypto.randomUUID()`, and `crypto.getRandomValues()`. `new Date(<literal/expr>)` is a fixed
  instant and stays clean, and the file-wide fake-timer suppression applies. Aliased/destructured
  clock reads (`const now = Date.now; now()`) stay out: tracking them would trade a rare miss for
  a frequent false positive on user `now()` helpers (#46).
- `C48` (dark patch): a test that flips a known test-mode flag into test mode and then
  asserts is exercising the product's test-only branch, not real behaviour. Detection-only;
  v1 covers raw writes (`process.env.NODE_ENV = "test"`, `process.env.TESTING = "1"`,
  `settings.TESTING = true`). `NODE_ENV` only counts as `"test"`; config values and product
  feature flags are not flagged; a flag write with no assertion after it is setup, not a dark
  patch. Parity with falsegreen (Python) `C48`, same id and J1/low (#39).

### Tests
- Lock the floating `expect(p).resolves`/`.rejects.<matcher>()` case for `JS5`: a non-awaited
  promise matcher is already flagged through the oracle registry (the matcher builds a promise
  that never settles before the test ends), and tests now pin that, including an exact-count
  guard so a future change cannot double-report it. Awaited/returned forms stay clean (#43).
- Characterization tests for the cfg reachability edge cases: for-in (C20 after / C21 inside),
  labeled `break outer`, a switch case that falls through without escaping, an IIFE holding the
  only assertion (no phantom C21), and `performance.now()` C16 (#63).

### Changed
- `C20` and `C21` now use a structured intra-test reachability walk (`src/cfg.ts`) instead of
  a top-level-only scan. `C20` (dead code) catches an assertion after any non-falling-through
  statement: a `return`/`throw`, `process.exit()`, a `break`/`continue`, an `if` whose both
  arms terminate, a terminating block, or an exhaustive `switch` (every case plus a `default`
  escapes). `C21` (no unconditional assertion) fires only when no assertion is on the guaranteed
  spine; an assertion in an `if(true)` branch, a `finally`, or a `try` block now counts as
  guaranteed, and an assertion only in a `catch` or a loop body is correctly flagged. The walk
  stops at nested functions, so a `return` inside a `forEach`/IIFE callback no longer reads as
  dead code. False-positive-averse: anything unmodeled is treated as reachable/guaranteed (#35).
- README Status no longer pins a stale `0.1.0` literal; it points to STATUS.md for the current
  version and coverage. Removed two boolean sub-clauses fully subsumed by their first disjunct
  in `isTestBlock` and the JS6 suite guard (behavior-preserving) (#64, #65).

### Fixed (earlier in the 0.4.0 cycle)
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

[Unreleased]: https://github.com/vinicq/falsegreen-js/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/vinicq/falsegreen-js/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/vinicq/falsegreen-js/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vinicq/falsegreen-js/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vinicq/falsegreen-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vinicq/falsegreen-js/releases/tag/v0.1.0
