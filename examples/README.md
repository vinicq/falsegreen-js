# falsegreen-js examples

Worked samples for every code the scanner emits. Each code has a **BAD** test
the scanner flags and a **CLEAN** look-alike, one token away, it leaves alone -
so you can see both the smell and the legitimate pattern it must not be confused
with.

These are scan targets, not a runnable suite. The bodies call helpers that do
not exist on purpose: the scanner reads the syntax tree, it never imports or
runs them. `vitest.config.ts` excludes `examples/**` from collection, so
`npx vitest run` ignores this directory. `test/examples.test.ts` loads each file
as text and scans it with `analyze(parse(...))`, asserting every code below
fires in its file.

## Layout

Files are grouped by RiskGroup, the conceptual failure mode in `src/cases.ts`:

| File | RiskGroup | Codes |
|---|---|---|
| `effectiveness.test.ts` | no oracle / trivial oracle / wrong oracle | C2, C2b, C5, C6, C7, C8, C9, C18, C37, C44, JS3, JS13, JS15 |
| `execution.test.ts` | the check exists but never runs | C20, C21, CC, C48, JS1, JS2, JS4, JS5, JS6, JS7, JS8, JS9, JS11, JS17, JS18, JS21, JS22, JS23 |
| `nondeterminism.test.ts` | passes or fails by luck (time, randomness) | C16 |
| `dependency.test.ts` | real I/O or a stand-in for the unit | C23 |
| `cypress.cy.ts` | Cypress query never asserted | JS24 |
| `diagnostics.test.ts` | maintainability (opt-in, off by default) | D1, D3, D4, D6, D7, D8, M2 |
| `c16-fake-timers.test.ts` | C16 frozen-clock look-alike | (none: time controlled) |

Two codes need their own file because a file-wide signal changes the result:

- **C16** is suppressed for any file that installs fake timers (a
  `useFakeTimers` / `runAllTimers` / `tick` token anywhere in the text). The BAD
  reads live in `nondeterminism.test.ts` (no such token); the frozen-clock CLEAN
  look-alike lives in `c16-fake-timers.test.ts`.
- **JS24** reads as a Cypress spec only in a `.cy.ts` file, so it has its own.

## Run the scanner on the examples

```bash
node dist/cli.js examples
```

The BAD tests are reported; the `*_clean` look-alikes are not. The diagnostic
group (D*/M2) is off by default; surface it with `--diagnostics`:

```bash
node dist/cli.js examples --diagnostics
```

## Codes with no test-file example

`PL7`, `PL8`, `PL10` are the project layer: they audit the Jest/Vitest config
(`--config-audit`), not any one test file, so they cannot have a `.test.ts`
case. `M2` (long test body) is shown only as its focused clean alternative; a
50-line body would add noise. The remaining catalog codes (the still-skipped
JS-series semantic ones) are documented in
[ARCHITECTURE.md](../ARCHITECTURE.md).
