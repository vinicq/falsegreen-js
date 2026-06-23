# falsegreen-js

Find JavaScript/TypeScript unit tests that give false positives: green tests that
protect nothing, and tests that pass while asserting the wrong thing. Deterministic
AST scan, no code execution. Sibling of [`falsegreen`](https://github.com/vinicq/falsegreen)
(the Python scanner); same contract, JS/TS rule set.

Covers `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`.

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
npx falsegreen-js --json          # machine-readable output
npx falsegreen-js --output report.json   # write to a file
npx falsegreen-js --output .falsegreen/  # write report.<ext> into a directory
npx falsegreen-js --disable C7,JS3
```

Each finding is reported with its pyramid level (unit / integration / e2e, read from the file's imports) and a one-line fix hint, and the summary breaks the findings down by level and lists the most common fixes. `--output` takes a file or a directory: an extension-less or trailing-slash path (e.g. `.falsegreen/`) receives `report.<ext>` for the chosen format. Reports are run artifacts; keep the output directory gitignored.

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
| C20 | high | assertion in dead code after a `return`/`throw` — it never runs |
| C23 | low  | reads a real file at a literal path, or a hard-coded URL (mystery guest) |
| C8  | low  | exact equality on a float (use `toBeCloseTo`) |
| C9  | low  | `toThrow()` with no error type or message — accepts any error |
| C16 | low  | result depends on `Date.now`, `Math.random`, or a fixed timer |
| C18 | low  | compares `String(x)` / `JSON.stringify(x)` / `` `${x}` `` to a literal (formatting, not value) |
| C21 | low  | every assertion is conditional — none runs unconditionally |
| C37 | low  | duplicate case in `it.each`/`test.each` — the same scenario runs twice |
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

Each code carries a judgment tag (J1-J6) shared with the
[falsegreen-skill](https://github.com/vinicq/falsegreen-skill) semantic framework.

### Opt-in: maintainability group (default off)

These are **not** false-green — the test still protects something — so they are off by
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
  so it always fails. That is a loud red test, the opposite of false-green, and out of scope.
- **JS20** (a Promise compared without `resolves`/`rejects`): telling that a value is a
  Promise needs type information the parser does not have, so it would be too noisy.
- **JS12** (a floating promise whose `expect` is never returned): already covered by JS7.
- **JS16** (`async` test with no `expect.assertions(n)`): the absence of a guard is not a
  smell on its own; flagging it would fire on most async tests.
- **JS10** (any conditional in a test body): handled by `eslint-plugin-jest`
  (`no-conditional-in-test`); JS9 and C21 already cover the false-green subset.

### What carries over from falsegreen, what does not

Ported (same concept): C2, C2b, C5, C7, C8, C16, CC.

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

Precedence: CLI `--disable` > config `disable`/`severity` > catalog default.

## Scope and honesty

This is a static scanner. It owns what the structure proves. Two things it does not
decide: whether the expected value contradicts the intended behavior, and whether the
test re-implements the production logic. Those are semantic and belong to the
`falsegreen-skill` LLM pass. Precision over recall: a softened heuristic that misses a
case is preferred to one that flags correct code.

## References

The catalog is grounded in the test-smell literature. Direct influences: the
rotten-green-test work that names this whole family (Delplanque et al., ICSE 2019),
the founding test-smell refactoring catalog (van Deursen et al., XP 2001), the
JS/TS empirical studies (Jorge, UFCG 2023; Silva, PUC Minas 2022 — the academic
precedent for the focused-test and snapshot codes; Oliveira et al., SBES 2024/2025),
and the detection-tool baselines (tsDetect, Peruma et al., 2020). Full list and the
code-to-source mapping in [CREDITS.md](CREDITS.md).

## Status

`0.1.0`, early. The rule set is a deterministic core; the full JS/TS smell catalog is
tracked as research in the private audit hub. Issues and PRs welcome.

## License

MIT, Vinicius Queiroz.
