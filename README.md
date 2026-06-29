# falsegreen-js

[![CI](https://github.com/vinicq/falsegreen-js/actions/workflows/ci.yml/badge.svg)](https://github.com/vinicq/falsegreen-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/falsegreen-js.svg)](https://www.npmjs.com/package/falsegreen-js)
[![Node](https://img.shields.io/node/v/falsegreen-js.svg)](https://www.npmjs.com/package/falsegreen-js)
[![Downloads](https://img.shields.io/npm/dm/falsegreen-js.svg)](https://www.npmjs.com/package/falsegreen-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docs](https://img.shields.io/badge/docs-online-blue.svg)](https://vinicq.github.io/falsegreen-docs/)

Find JavaScript/TypeScript unit tests that give false positives: green tests that
protect nothing, and tests that pass while asserting the wrong thing. Deterministic
AST scan, no code execution. Sibling of [`falsegreen`](https://github.com/vinicq/falsegreen)
(the Python scanner); same contract, JS/TS rule set.

Covers `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`.

**The falsegreen family** (install the one for your stack):

| Tool | Stack | Install | Package |
|---|---|---|---|
| [falsegreen](https://github.com/vinicq/falsegreen) | Python / pytest | `pip install falsegreen` | [PyPI](https://pypi.org/project/falsegreen/) |
| **falsegreen-js** | JS / TS | `npm i -D falsegreen-js` (`npx falsegreen-js`) | [npm](https://www.npmjs.com/package/falsegreen-js) |
| [robotframework-falsegreen](https://github.com/vinicq/robotframework-falsegreen) | Robot Framework | `pip install robotframework-falsegreen` | [PyPI](https://pypi.org/project/robotframework-falsegreen/) |
| [falsegreen-skill](https://github.com/vinicq/falsegreen-skill) | semantic LLM pass | `npx falsegreen-skill analyze <path>` | [npm](https://www.npmjs.com/package/falsegreen-skill) |

## Quick guide for first-time users

New here? Start with these five sections. They get you from zero to a CI gate. The deeper reference (every code, the scope rules, the research) follows after.

### What it does

falsegreen-js reads your Jest / Vitest / Mocha / Playwright tests and finds the ones that pass green without checking anything. A test can call your code, run, and report success while asserting nothing real, so a bug ships and the green bar lies about it. The scanner reads the test files only (it never runs them) and flags the spots a parser can prove are empty, always true, unreachable, or never awaited.

A test it flags, and the fix:

```ts
// BAD: runs the code, then asserts a constant. It can never fail.
test("sum adds numbers", () => {
  const result = sum(2, 3);
  expect(true).toBe(true);
});

// CLEAN: asserts the actual result. Breaks if sum() breaks.
test("sum adds numbers", () => {
  expect(sum(2, 3)).toBe(5);
});
```

### Install

```bash
npm install -g falsegreen-js
```

Or skip the install and run the latest from npm with `npx falsegreen-js .`. For a project-local dev dependency, `npm install -D falsegreen-js`. Needs Node 18 or newer.

### Quick start

Point it at your project:

```bash
npx falsegreen-js .
```

Run on the `sum` example above and you get:

```
sum.test.ts
  HIGH C5   L5  always-true check (expect(true).toBe(true), assert(1))
         both sides are the same literal
         level: unit   fix: assert the real behaviour, not a constant or tautology

1 high, 0 low. https://github.com/vinicq/falsegreen-js
By level: unit:1
Top fixes:
  C5 (1): assert the real behaviour, not a constant or tautology
```

How to read that finding:

- `sum.test.ts` then `L5` - the file and line.
- `C5` - the code. C5 is "always-true check". The catalog (below) explains every code.
- `level: unit` - which level of the test pyramid this file sits at.
- `fix:` - the one-line hint. Here: assert the real behaviour, not a constant.

`node dist/cli.js .` runs the same scan from a cloned checkout.

### Common options

```bash
npx falsegreen-js . --json          # machine-readable JSON instead of text
npx falsegreen-js . --format sarif  # text (default) | json | sarif | junit
npx falsegreen-js . --disable C7,JS3  # turn specific codes off
```

Exit codes wire it into CI: `0` clean, `10` low-confidence findings only, `20` at least one high-confidence finding. Block the build on `20`.

GitHub Actions:

```yaml
name: falsegreen-js
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npx falsegreen-js .   # exit 20 fails the job
```

### What the codes mean

Each finding carries a code and a confidence. HIGH codes are near-certain and block the commit; LOW codes warn and want a human look. Codes shared with the Python scanner keep the same id (`C5`, `C7`, `C2b`...); `JS*` codes are JS/TS-specific (`JS1` focused `it.only`, `JS2` `expect` with no matcher, `JS5` an async query never awaited). The full list is in the [Case catalog](#case-catalog) below and the [online docs](https://vinicq.github.io/falsegreen-docs/).

## Usage and configuration reference

The quick guide above gets you running. This section is the complete reference: every install channel, every flag, every output format, every config knob, and the CI recipes. All command output shown here is captured from a real run, not invented.

### Install

| Channel | Command | When to use |
|---|---|---|
| dev dependency | `npm install -D falsegreen-js` | the normal install; pins it in `package.json`, runs as `npx falsegreen-js` |
| global | `npm install -g falsegreen-js` | the `falsegreen-js` command on your PATH everywhere |
| no install | `npx falsegreen-js .` | one-off, runs the latest published version |
| from a clone | `node dist/cli.js .` after `npm run build` | hacking on the scanner |

Version floor: **Node 18 or newer**. Covers `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`. Pin a version in CI with `npm install -D falsegreen-js@0.6.2` or `npx falsegreen-js@0.6.2 .`.

### Invocation

```bash
npx falsegreen-js                   # scan the current directory
npx falsegreen-js src test          # scan several paths
npx falsegreen-js src/foo.test.ts   # scan a single file
npx falsegreen-js --staged          # only test files staged in git (pre-commit)
node dist/cli.js .                  # from a built checkout, identical behaviour
```

There is no stdin mode: pass file or directory paths (or nothing, which scans the cwd). The scanner walks the paths for `.spec`/`.test` files in the eight extensions above; component files (`.vue`, `.svelte`) and templates are not test files and are skipped.

### Output formats

`--format text|json|sarif|junit` selects the shape (default `text`). `--json` is a shorthand for `--format json`. `--output PATH` writes to a file instead of stdout; a directory or trailing-slash path (`.falsegreen/`) receives `report.<ext>`.

Fixture used for every sample below (`sum.test.ts`):

```ts
import { sum } from "./sum";

test("sum adds numbers", () => {
  const result = sum(2, 3);
  expect(true).toBe(true);   // C5: always-true, line 5
});

test("sum is truthy", () => {
  expect(sum(2, 3)).toBeTruthy();   // C6: weak check, line 9
});
```

**text** (default):

```
sum.test.ts
  HIGH C5   L5  always-true check (expect(true).toBe(true), assert(1))
         both sides are the same literal
         level: unit   fix: assert the real behaviour, not a constant or tautology
  low  C6   L9  weak check — only verifies something came back (toBeTruthy/toBeDefined, length > 0)
         only checks the value is present, not the expected result
         level: unit   fix: assert the actual value, not just that something came back

1 high, 1 low. https://github.com/vinicq/falsegreen-js
By level: unit:2
Top fixes:
  C5 (1): assert the real behaviour, not a constant or tautology
  C6 (1): assert the actual value, not just that something came back
```

**json** (`--json` or `--format json`): an envelope with `tool`, `version`, the judgment legend, and a `findings` array.

```json
{
  "tool": "falsegreen-js",
  "version": "0.6.2",
  "oracleRegistryVersion": 2,
  "judgments": { "J1": "does the assertion actually run?", "...": "..." },
  "findings": [
    {
      "file": "sum.test.ts",
      "line": 5,
      "code": "C5",
      "detail": "both sides are the same literal",
      "confidence": "high",
      "title": "always-true check (expect(true).toBe(true), assert(1))",
      "level": "unit",
      "riskGroup": "effectiveness",
      "group": "false-positive",
      "fix": "assert the real behaviour, not a constant or tautology"
    }
  ]
}
```

**sarif** (`--format sarif`): SARIF 2.1.0 for GitHub code scanning. HIGH maps to `error`, LOW to `warning`, off to `note`; result tags carry the judgment (J1-J6), the risk group, and the level. Abridged:

```json
{
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": { "driver": {
        "name": "falsegreen-js",
        "version": "0.6.2",
        "rules": [
          { "id": "C5", "defaultConfiguration": { "level": "error" },
            "properties": { "tags": ["J2"] } }
        ]
      } },
      "results": [
        { "ruleId": "C5", "level": "error",
          "message": { "text": "always-true check (expect(true).toBe(true), assert(1)) (both sides are the same literal)" },
          "properties": { "tags": ["J2", "risk:effectiveness", "level:high"] },
          "locations": [ { "physicalLocation": {
            "artifactLocation": { "uri": "sum.test.ts" },
            "region": { "startLine": 5 } } } ] }
      ]
    }
  ]
}
```

**junit** (`--format junit`): JUnit XML. HIGH becomes a `<failure>`, lower findings become `<skipped>`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<testsuites name="falsegreen-js" tests="2" failures="1" skipped="1" errors="0">
  <testsuite name="falsegreen-js" tests="2" failures="1" skipped="1" errors="0">
    <testcase classname="falsegreen-js.C5" name="C5 sum.test.ts:5">
      <failure message="always-true check (expect(true).toBe(true), assert(1)) (both sides are the same literal)">sum.test.ts:5</failure>
    </testcase>
    <testcase classname="falsegreen-js.C6" name="C6 sum.test.ts:9">
      <skipped message="weak check ..."></skipped>
    </testcase>
  </testsuite>
</testsuites>
```

These formats match the [Python sibling](https://github.com/vinicq/falsegreen) concept-for-concept, so a pipeline can swap one scanner for the other.

### Configuration

**Exit codes** (the contract CI relies on):

| Code | Meaning |
|---|---|
| `0` | clean, or only off/baselined findings |
| `10` | low-confidence findings only |
| `20` | at least one high-confidence finding |

Block the build on `20`. `10` is a warn band you can choose to fail or not.

**Disable codes:** `--disable C7,JS3` turns codes off for this run. Persist it with `"disable": [...]` in config.

**Enable codes:** `--enable D8,M2` re-activates listed off or opt-in codes at their catalog severity. It flips a default-off code on but cannot raise a code above catalog. A code passed to both `--enable` and `--disable` stays off, `--disable` wins.

**Diagnostics:** `--diagnostics` reports the opt-in maintainability group (`D1`, `D3`, `D4`, `D6`, `D7`, `D8`, `M2`) as warnings. These are not false-green, the test still protects, so they are off by default. Run on a test with two literal asserts:

```
diag.test.ts
  HIGH C5   L2  always-true check (expect(true).toBe(true), assert(1))
         both sides are the same literal
         level: unit   fix: assert the real behaviour, not a constant or tautology
  low  D8   L3  magic number in an assertion — a bare numeric literal instead of a named constant
         magic number 2 in the assertion
         level: unit   fix: name the magic number with a constant
```

**Inline suppression:** a comment on the offending line.

```ts
expect(user.id).toBe(user.id); // falsegreen: ignore[C7]   // silence only C7
expect(x);                     // falsegreen: ignore        // silence every code on this line
```

**Severity and confidence filtering:** there is no `--severity` flag. You tune severity per code in config; values are `high`, `low`, `off` (and the diagnostics live behind `--diagnostics` or per-code config).

**Config file:** `falsegreen.json`, `.falsegreenrc.json`, or a `"falsegreen"` key in `package.json`.

```json
{
  "disable": ["C8"],
  "exclude": ["**/legacy/**"],
  "severity": { "JS3": "off", "C16": "high" }
}
```

Precedence: CLI `--disable` > CLI `--enable` > config `disable`/`severity` > catalog default.

**`--config-audit`** is a separate mode: instead of scanning test files it reads the Jest/Vitest config (`package.json` `jest` field, `jest.config.*`, `vitest.config.*`) and reports the project-layer ways a suite stays green by configuration. Run on a `package.json` with `passWithNoTests: true` and `bail: 1`:

```
package.json
  low  PL7  L1  no coverage gate (coverageThreshold / coverage.thresholds) ...
  low  PL8  L1  bail stops the run early (bail) ...
  low  PL10 L1  passWithNoTests lets an empty or fully-filtered suite report green
```

The PL codes: `PL7` (no `coverageThreshold` / `coverage.thresholds`), `PL8` (`bail` stops the run early), `PL10` (`passWithNoTests` passes an empty or filtered-to-nothing run). The per-file scan cannot see config.

**`--baseline` / `--write-baseline`** ratchet the scanner onto a large codebase without fixing every legacy finding at once. Put the paths first and the flag last, since the flag's optional value would otherwise eat the next argument:

```bash
npx falsegreen-js . --write-baseline   # record current findings to .falsegreen-baseline.json, exit 0
npx falsegreen-js . --baseline         # report and fail only on net-new findings
```

Captured:

```
falsegreen-js: wrote 1 fingerprint(s) to .falsegreen-baseline.json
```

A finding's identity is a content fingerprint (`sha1` of relative path + code + detail, no line number), so it survives unrelated line shifts. Both flags default to `.falsegreen-baseline.json`; pass an explicit path to override. Commit the baseline so CI sees the same set.

### CI integration

**GitHub Actions** (text gate plus SARIF upload to code scanning):

```yaml
name: falsegreen-js
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write      # required for the SARIF upload
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Scan and emit SARIF
        run: npx falsegreen-js . --format sarif --output falsegreen.sarif
        continue-on-error: true   # let the upload run even when exit 20
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: falsegreen.sarif }
      - name: Fail on high-confidence findings
        run: npx falsegreen-js .  # exit 20 fails the job
```

**Pre-commit hook** (the repo ships a `.pre-commit-hooks.yaml`):

```yaml
  - repo: https://github.com/vinicq/falsegreen-js
    rev: v0.6.3          # pin a tag; run `pre-commit autoupdate` to move it
    hooks:
      - id: falsegreen-js
```

Then `pre-commit install`. The hook entry is `falsegreen-js --staged` with `pass_filenames: false` (the `node` language runs it through the installed package), so it reads the staged test files itself; do not add file arguments. HIGH findings block the commit.

### Scope: what it does NOT do

It is a static AST scanner: it never runs your tests. It does not decide whether an expected value contradicts intended behaviour, nor whether a test re-implements the production logic. Those are semantic and belong to the [falsegreen-skill](https://github.com/vinicq/falsegreen-skill) LLM pass. For the layer no static scan reaches (does a green test fail when the code is wrong?), run a mutation tester like [Stryker](https://stryker-mutator.io/). Precision over recall: a softened heuristic that misses a case is preferred to one that flags correct code. The full catalog is in the [Case catalog](#case-catalog) below and the [online docs](https://vinicq.github.io/falsegreen-docs/).

## Why

A test can be green and still protect nothing: an empty body, an assertion that is
never reached, `expect(x).toBe(x)`, `expect(value)` with no matcher, a focused
`it.only` that silently parks the rest of the suite, a `findByText` that is never
awaited. AI-generated tests produce these in bulk. This tool flags the mechanical
patterns a parser can prove, before they reach review.

## Install

```bash
npm install -D falsegreen-js
```

## Usage

```bash
npx falsegreen-js                 # scan cwd
npx falsegreen-js src test        # scan paths
npx falsegreen-js --staged        # only test files staged in git (pre-commit)
npx falsegreen-js --json          # machine-readable output (alias for --format json)
npx falsegreen-js --format sarif  # SARIF 2.1.0 for GitHub code scanning
npx falsegreen-js --format junit  # JUnit XML for CI test reporters
npx falsegreen-js --output report.json   # write to a file
npx falsegreen-js --output .falsegreen/  # write report.<ext> into a directory
npx falsegreen-js --config-audit  # audit Jest/Vitest config (project-layer PL codes)
npx falsegreen-js --disable C7,JS3
npx falsegreen-js --enable D8,M2   # re-activate off/opt-in codes at catalog severity
```

Each finding is reported with its pyramid level (unit / integration / e2e, read from the file's imports) and a one-line fix hint, and the summary breaks the findings down by level and lists the most common fixes. `--output` takes a file or a directory: an extension-less or trailing-slash path (e.g. `.falsegreen/`) receives `report.<ext>` for the chosen format. Reports are run artifacts; keep the output directory gitignored.

### Output formats

`--format text|json|sarif|junit` (default `text`; `--json` stays as an alias for `--format json`). These match the [Python sibling](https://github.com/vinicq/falsegreen) byte-for-concept, so a pipeline can swap one scanner for the other.

- **`sarif`**: SARIF 2.1.0. One rule per code present, one result per finding, with `error` for high-severity findings, `warning` for low, and `note` for off. Result tags carry the judgment (J1-J6), the risk group (`risk:effectiveness`...), and the level (`level:high`). Upload it to GitHub code scanning to see findings inline on the PR.
- **`junit`**: JUnit XML. High-severity findings become `<failure>`, everything else `<skipped>`, so a CI test reporter surfaces them as a failing suite.

### Baseline (ratchet)

Adopting the scanner on a large codebase without fixing every legacy finding at once:

```bash
npx falsegreen-js --write-baseline   # record current findings to .falsegreen-baseline.json, exit 0
npx falsegreen-js --baseline         # report and fail only on findings not in the baseline
```

`--baseline [PATH]` and `--write-baseline [PATH]` default to `.falsegreen-baseline.json`. A finding's identity is a content fingerprint (`sha1` of relative path + code + detail, no line number), so it survives unrelated line shifts in the file. Commit the baseline, then let CI block only on net-new findings. (The fingerprint omits the source snippet the Python scanner folds in, since the js scanner does not carry one; two findings with the same code and detail in one file share an id.)

`--config-audit` is a separate mode: instead of scanning test files, it reads the Jest/Vitest config (`package.json` `jest` field, `jest.config.*`, `vitest.config.*`) and reports the project-layer ways a suite stays green by configuration: `PL10` (`passWithNoTests` passes an empty or filtered-to-nothing run), `PL7` (no `coverageThreshold` / `coverage.thresholds`), `PL8` (`bail` stops the run early). The per-file scan cannot see config.

For the layer no static scan reaches (does a green test fail when the code is wrong?), run a **mutation tester** like [Stryker](https://stryker-mutator.io/). falsegreen-js is the cheap pre-filter on every commit; mutation testing is the deeper audit.

Exit code: `0` clean, `10` low-confidence only, `20` high-confidence present. Wire it
into CI or a pre-commit hook and let exit `20` block the commit.

Suppress a single finding inline:

```ts
expect(user.id).toBe(user.id); // falsegreen: ignore[C7]
expect(x);                     // falsegreen: ignore
```

## Runner coverage

Runner-agnostic. The assertion and test vocabulary spans Jest, Vitest, Mocha + Chai,
Jasmine, AVA, `node:test`, tap, Cypress, Playwright, Testing Library
(`@testing-library/*` with `jest-dom` / `jasmine-dom` matchers and `user-event`),
and Vue Test Utils (`mount`/`wrapper.find`/`flushPromises`/`nextTick`).
`expect().matcher()`, chai `expect().to`, `assert`, `x.should`, and AVA `t.is` all
count as real assertions, so a Mocha or AVA test is not mistaken for one that never
checks anything.

Note: component files (`.vue`, `.svelte`, `.astro`, `.marko`) and templates (`.html`)
are not test files. Tests for those frameworks are written in `.spec`/`.test` files in
the eight extensions above, which is what the scanner reads.

## Test levels (the pyramid)

falsegreen-js scans tests at every level of the pyramid. Discovery is level-agnostic - it
reads any test file - but a few codes are read in light of the level, so a valid pattern at
one level is not flagged at another.

- **Unit:** a function or component with its boundaries doubled. The oracle is `expect`.
- **Integration (API and database):** API tests through supertest / chai-http
  (`request(app).get("/").expect(200)`, recognized as an assertion) or `fetch`, and database
  tests through Prisma / TypeORM / Knex against a real datastore. These cross the I/O
  boundary on purpose, so the response or row IS the verification at that level.
- **E2E:** Cypress (`.cy.*`) and Playwright (`.e2e.*`). `cy.get().should(...)` and
  `expect(page).toHaveURL(...)` are the oracle; a visible element is a real check here, not a
  weak one.

A real API or database call inside a test that claims to be a unit test is itself the smell
(mystery guest, environment coupling), not the level of the test. C23 flags the hard-coded
file path or URL form.

## Case catalog

Codes shared with `falsegreen` (Python) keep the same id, so cross-language results
line up in the research. `JS*` codes are ecosystem-specific.

| Code | Confidence | What it flags |
|---|---|---|
| C2  | high | test with no check at all (empty body) |
| C2b | low  | test calls code but asserts nothing |
| C5  | high | always-true check (`expect(true).toBe(true)`, `assert(1)`) |
| C6  | low  | weak check — only verifies something came back (`toBeTruthy`/`toBeDefined`, `length > 0`) |
| C7  | high | compares a thing to itself (`expect(x).toBe(x)`) |
| C44 | high | numeric tautology — a length compared so the result is always true (`x.length >= 0`) |
| C20 | high | assertion in unreachable code (after a `return`/`throw`/`process.exit`, a `break`, a both-arms-terminating `if`, or an exhaustive `switch`) — it never runs |
| C23 | low  | reads a real file at a literal path, or a hard-coded URL (mystery guest) |
| C8  | low  | exact equality on a float (use `toBeCloseTo`) |
| C8b | low  | `toBeCloseTo` with no precision argument — the default 2-digit tolerance may be too loose |
| C9  | low  | `toThrow()` with no error type or message — accepts any error |
| C11a | low | self-confirming literal — the expected value is bound from the same call under test (`const e = foo(); expect(foo()).toBe(e)`) |
| C16 | low  | result depends on `Date.now`, `Math.random`, or a fixed timer |
| C18 | low  | compares `String(x)` / `JSON.stringify(x)` / `` `${x}` `` to a literal (formatting, not value) |
| C21 | low  | every assertion is conditional — none runs unconditionally |
| C37 | low  | duplicate case in `it.each`/`test.each` — the same scenario runs twice |
| C48 | low  | dark patch — the test flips a test-mode flag (`process.env.NODE_ENV = "test"`, `process.env.TESTING`, a `TESTING` flag) then asserts, exercising the product's test-only branch |
| CC  | low  | commented-out assertion |
| JS1 | high | focused test (`it.only` / `fit`) silently skips the rest of the suite |
| JS2 | high | `expect(x)` with no matcher — the assertion never runs |
| JS3 | low  | snapshot is the only assertion |
| JS4 | low  | skipped test (`it.skip` / `xit` / `it.todo`) never runs |
| JS5 | low  | async query/event not awaited (`findBy*` / `waitFor` / `user-event`) |
| JS6 | high | empty `describe`/`suite` — the suite is green but runs nothing |
| JS7 | low  | assertion inside a non-awaited `setTimeout`/`then` callback — may run after the test ends |
| JS8 | low  | mocks the unit under test (`jest.mock`/`vi.mock` of an imported module asserted directly) |
| JS9 | high | assertion in a dead branch (`if(false)` / `if(true){}else`) — never runs |
| JS11 | low | `try/catch` swallows the assertion — a failing `expect` is caught, test stays green |
| JS13 | low | query (`getBy*`/`queryBy*`) as a loose statement — its result is never asserted |
| JS15 | low | inappropriate assertion — comparison wrapped in a boolean (`expect(a===b).toBe(true)`), blind failure message |
| JS17 | low | commented-out test block (`// it(...)` / `// test(...)`) — disabled, no longer runs |
| JS18 | low | test takes a `done` callback instead of async/await — a mistimed `done` passes early |
| JS21 | high | matcher referenced but never called (`expect(x).toBe` with no `()`) — the assertion never runs |
| JS22 | high | empty `it.each`/`test.each` table — generated with zero cases, never runs |
| JS23 | high | `expect.assertions(N)` with fewer unconditional `expect()` calls than N — the guard can never be met |
| JS24 | low  | Cypress query (`cy.get`/`cy.find`/`cy.contains`) as a loose statement with no terminating `.should`/`.and` and no `expect` in `.then` — its result is never asserted |
| JS25 | high | the only assertion sits inside an array-iterator callback (`forEach`/`map`/`filter`/`some`/`every`/`flatMap`) — runs zero times on an empty collection |
| JS26 | low  | fake timers installed but never advanced (`runAllTimers`/`advanceTimersByTime`/`tick`) — the scheduled callback never fires, so the assertion reads un-mutated state |
| JS27 | low  | `toHaveBeenCalled*` is the sole oracle on a locally-created double — verifies wiring, not behaviour |
| JS29 | low  | `expect(...).resolves`/`.rejects` chain is a bare statement, not awaited or returned — the test finishes green before the matcher settles |
| JS30 | high | literal-vs-literal assertion (`expect(2).toBe(3)`, chai `expect(x).to.equal(y)`) — both operands are fixed at parse time |
| JS31 | low  | `try/catch` swallows a possible throw with no assertion on the exception — a unit that stops throwing still passes green |

Each code carries a judgment tag (J1-J6) shared with the
[falsegreen-skill](https://github.com/vinicq/falsegreen-skill) semantic framework.

### Opt-in: maintainability group (default off)

These are **not** false-green - the test still protects something - so they are off by
default. Enable them with `--diagnostics`, or per code via config `severity`. They are a
"plus" for test-code health, mirroring falsegreen's diagnostic/coupling groups.

| Code | Group | What it flags |
|---|---|---|
| D1 | diagnostic | assertion roulette — many assertions in one test |
| D3 | diagnostic | duplicate assert — the same assertion repeated |
| D4 | diagnostic | `it.each`/`test.each` without titled cases (index-only) |
| D6 | diagnostic | `console.*` in a test body |
| D7 | diagnostic | anonymous test — empty or missing description |
| D8 | diagnostic | magic number — a bare numeric literal as the expected value |
| M2 | coupling | test body exceeds the line-count threshold |

```bash
npx falsegreen-js --diagnostics      # include D*/M* as warnings
```

### Deliberately not implemented

Some catalog codes were reviewed and left out, on purpose:

- **JS19** (`toBe` on an object/array literal): `expect(x).toBe({...})` compares by reference,
  so it always fails. That is the false-red axis (a test that always fails), the opposite of
  what this scanner looks for, and out of scope on principle.
- **JS20** (a Promise compared without `resolves`/`rejects`): telling that a value is a
  Promise needs type information the AST does not carry, so it would be too noisy.
- **JS12** (a floating promise whose `expect` is never returned): already covered by JS7.
- **JS16** (`async` test with no `expect.assertions(n)`): the *absence* of a guard is not a
  smell on its own; flagging it would fire on most async tests. The implemented sibling is
  `JS23`, which fires on a present-but-unsatisfiable guard: `expect.assertions(N)` with a
  numeric `N` higher than the unconditional `expect()` calls that can run, so the count can
  never be met.
- **JS14** (a giant inline snapshot): a readability and review-noise concern, not a
  false-green one. The snapshot still protects, so it belongs to the diagnostic group and is
  better served by `eslint-plugin-jest` (`no-large-snapshots`) as an opt-in lint rule.
- **JS10** (any conditional in a test body): handled by `eslint-plugin-jest`
  (`no-conditional-in-test`); JS9 and C21 already cover the false-green subset.
- **C1** (an assertion under an `if`/`for` that may not run): redundant once C21 and JS9
  exist, and high-FP on its own. C21 already fires the actual false-green case, where
  *every* assertion is conditional and the test can pass with nothing checked. A test that
  mixes a conditional assertion with an unconditional one is not false-green: the
  unconditional assertion still protects. JS9 covers the dead-branch form (`if(false)`).
  Flagging every conditional assertion (C1's full scope) is the linter concern JS10 already
  names (`no-conditional-in-test`), so C1 would add noise without a new false-green signal.

### What carries over from falsegreen, what does not

Ported (same concept): C2, C2b, C5, C7, C8, C16, C44, C48, CC.

Python-only, not applicable to JS/TS: pytest collection rules (C4 family), `pytest.raises`
breadth (C9/C19/C27/C28), fixtures and `os.environ`/global-state codes (C23/C24/C29),
sklearn/torch/tensorflow metric and seed codes (C33, parts of C16), xfail (C25), and the
xunit/`self.assert*` codes. These have no JS equivalent or need a different signal.

JS/TS-only (new here): JS1-JS5 above. The `describe.only`/skip, snapshot, no-matcher,
and not-awaited patterns are specific to the JS test runners and Testing Library.

## Configuration

Optional. `falsegreen.json`, `.falsegreenrc.json`, or a `"falsegreen"` key in
`package.json`:

```json
{
  "disable": ["C8"],
  "exclude": ["**/legacy/**"],
  "severity": { "JS3": "off", "C16": "high" }
}
```

Precedence: CLI `--disable` > CLI `--enable` > config `disable`/`severity` > catalog default. `--enable <codes>` re-activates listed off or opt-in codes at their catalog severity (it flips a default-off code on; it cannot raise a code above catalog). A code passed to both `--enable` and `--disable` stays off — `--disable` wins.

## Scope and honesty

This is a static scanner. It owns what the structure proves. Two things it does not
decide: whether the expected value contradicts the intended behavior, and whether the
test re-implements the production logic. Those are semantic and belong to the
`falsegreen-skill` LLM pass. Precision over recall: a softened heuristic that misses a
case is preferred to one that flags correct code.

Measured against the [Open Catalog of Test Smells](https://test-smell-catalog.readthedocs.io/) (517 documented smells), only the false-green slice is in scope. What stays out, on purpose: **brittleness / false-red** (sensitive equality, brittle assertions - the opposite axis), **hygiene / maintainability** (assertion roulette, magic numbers, long tests - linter territory, a few surfaced as opt-in diagnostics), and **slow, design, naming, duplication, runtime/culture** (none about whether the test protects). The boundary is deliberate: where a smell has a statically provable false-green form, that form is a code here - uncontrolled `Date.now`/`Math.random` is `C16`, a hard-coded path or URL is `C23`, an assertion that may never run is `C21`/`C20`, and JS-specific forms (focused tests, missing matchers) are the `JS*` codes. See [CREDITS.md](CREDITS.md) for the full cross-walk.

## References

The catalog is grounded in the test-smell literature. Direct influences: the
rotten-green-test work that names this whole family (Delplanque et al., ICSE 2019),
the founding test-smell refactoring catalog (van Deursen et al., XP 2001), the
JS/TS empirical studies (Jorge, UFCG 2023; Silva, PUC Minas 2022 - the academic
precedent for the focused-test and snapshot codes; Oliveira et al., SBES 2024/2025),
and the detection-tool baselines (tsDetect, Peruma et al., 2020). Full list and the
code-to-source mapping in [CREDITS.md](CREDITS.md).

## Status

The rule set is a deterministic core; the full JS/TS smell catalog is tracked as
research in the private audit hub. See [STATUS.md](STATUS.md) for the current version
and rule coverage. Issues and PRs welcome.

## License

MIT, Vinicius Queiroz.

## Contributors ✨

Thanks to the people who keep false-green tests out of real suites ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-2-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://vinicq.github.io/md-bridge/"><img src="https://avatars.githubusercontent.com/u/78210890?v=4?s=100" width="100px;" alt="Vinicius Queiroz"/><br /><sub><b>Vinicius Queiroz</b></sub></a><br /><a href="https://github.com/vinicq/falsegreen-js/commits?author=vinicq" title="Code">💻</a> <a href="https://github.com/vinicq/falsegreen-js/commits?author=vinicq" title="Documentation">📖</a> <a href="#ideas-vinicq" title="Ideas, Planning, & Feedback">🤔</a> <a href="#maintenance-vinicq" title="Maintenance">🚧</a> <a href="#infra-vinicq" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/vinicq/falsegreen-js/commits?author=vinicq" title="Tests">⚠️</a> <a href="#research-vinicq" title="Research">🔬</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/homesellerq-coder"><img src="https://avatars.githubusercontent.com/u/294912019?v=4?s=100" width="100px;" alt="Home Seller"/><br /><sub><b>Home Seller</b></sub></a><br /><a href="https://github.com/vinicq/falsegreen-js/commits?author=homesellerq-coder" title="Code">💻</a> <a href="https://github.com/vinicq/falsegreen-js/commits?author=homesellerq-coder" title="Documentation">📖</a> <a href="https://github.com/vinicq/falsegreen-js/commits?author=homesellerq-coder" title="Tests">⚠️</a> <a href="#infra-homesellerq-coder" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

New contributors are added automatically; the table also recognizes non-code work (docs, ideas, infrastructure, tests, research) via the [all-contributors](https://allcontributors.org) spec.
