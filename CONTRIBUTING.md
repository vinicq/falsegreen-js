# Contributing to falsegreen-js

Thanks for helping. falsegreen-js has one job: flag JS/TS tests that pass green
without protecting anything. Keep contributions inside that scope.

## Scope

In scope: a test that can stay green while the code is wrong (assertion never runs,
always true, compares a thing to itself, swallowed failure, no matcher, skipped/focused
suite). Out of scope: style, naming, size, and duplication, unless they make a passing
test unable to fail. When in doubt, ask: *is there a way for the code to be wrong and
this test to stay green?* If no, it is not a falsegreen-js code.

## Setup

```bash
npm ci
npm run build      # typecheck + compile to dist/
npm test           # vitest
node dist/cli.js test   # self-scan: the tool must not flag itself
```

## Adding a detection code

1. Add the entry to `src/cases.ts` (id, title, confidence, judgment J1-J6). Reuse a
   `C*` id when the smell matches the Python `falsegreen` concept; use a `JS*` id for
   ecosystem-specific patterns.
2. Implement the AST check in `src/rules.ts`. It must be provable from the syntax tree
   alone (no type-checker, no execution).
3. Add a test in `test/rules.test.ts`: one snippet that must flag, one clean look-alike
   that must not.
4. Document it in the README catalog and add a line to `CHANGELOG.md`.

Precision over recall. A softened heuristic that misses a case is preferred to one that
flags correct code. If a rule cannot be made precise, ship it as `low`, or not at all.

## Admission criteria for a new code

A code earns a place only if it clears every bar below. They are cumulative, not a
menu.

1. **Statically provable.** The decision comes from the AST and the types in front of
   you, never from a runtime guess. If proving the smell needs a value that only exists
   at run time, the code does not ship. A scanner that has to guess is a scanner that
   produces false positives.
2. **FP-guarded.** A false positive is worse than a miss. The tool is meant to gate
   commits, and one wrongly blocked legitimate test gets the whole tool turned off. When
   the evidence is ambiguous, the rule suppresses rather than fires. Try to break the
   rule before promoting it: helper-extracted assertions, parametrized tables, fixtures
   that assert, branch- or loop-guarded expects. If any of those trips it, tighten the
   heuristic or ship it `low`.
3. **A CLEAN look-alike one token from the BAD.** Every code ships with a pair: a BAD
   snippet the scanner flags and a CLEAN snippet it leaves alone, differing by about one
   token and traversing the same branch of the rule. The pair lives in `examples/` and
   in `test/rules.test.ts`. The CLEAN case is the one that matters: it proves the
   boundary is where the comment says it is, not one token wider.
4. **A catalog entry.** `src/cases.ts` carries the id, severity, judgment (J1-J6), and
   RiskGroup. No code emits without it.

A new code also passes a review gate before merge: the falsegreen-js agent panel reviews
it, and the principal reviewer signs off as the adversarial check. The reviewer's job is
to find the legitimate test that the new rule would wrongly flag. If that test exists,
the rule is not ready.

## Standing per-code FP-boundary rules

These are the boundaries that keep specific codes precise. They live in the source as
comments next to each check; stated here so a contributor changing one of these codes
knows the line it must not cross.

- **C44** (length tautology, `expect(x.length).toBeGreaterThanOrEqual(0)`) fires only on
  a *direct* `.length` property access. A derived expression that merely mentions
  `.length` (`a.length - b.length`) can be negative, so it is a real check and stays
  clean. Finiteness and NaN guards (`toBeLessThan(Infinity)`,
  `toBeGreaterThan(-Infinity)`) are not flagged: they are false for `NaN`, so they catch
  divide-by-zero and invalid-number bugs.
- **C6** (weak check: truthy/defined-only or `length > 0`) needs a non-literal subject.
  A literal subject is a different smell (C5, always-true), so C6 stays out of its lane.
- **JS5** (floating async query/event) flags a promise-form matcher only when its result
  is *observed* (assigned, or used where it must resolve) yet not awaited or returned.
  A bare floating call, an awaited call, and a returned call are all left alone: the
  first surfaces under a different code, the latter two settle on their own.
- **C16** (nondeterminism: `Math.random`, system clock, unseeded crypto, bare `new
  Date()`) is suppressed when fake timers are installed in the file. A frozen clock makes
  the value deterministic, so the signal would be a false positive.
- **JS23** (`expect.assertions(N)` shortfall) suppresses whenever the expect count is
  indeterminate: an `expect` inside a loop, a branch, a `.then`/callback, or a helper
  cannot be counted statically, so the shortfall is not provable and the rule stays
  quiet. It fires only when `N` is a numeric literal and the proven unconditional count
  falls short.
- **JS24** (unasserted Cypress query) fires on query commands (`cy.get`/`find`/
  `contains`) that produce a subject no one asserts. It excludes Cypress *action*
  commands (`click`/`type`/`visit`/...): an action does work rather than just query, so a
  chain ending in one stays clean.
- **JS8** (self-mock, `spyOn` form) binds a spied target to an `expect` subject only
  within the *same test body*. A `spyOn` is hoisted within its own test, not file-wide
  (unlike the `jest.mock` module form, which is matched separately), so the binding is
  scoped to that body to avoid matching a spy in one test against an assertion in
  another.

## Commit and PR

- Small, focused commits. Reference the issue.
- Run build + test + self-scan before opening the PR.
- The PR template lists the checklist.

## Code style

Match the surrounding code. TypeScript, ESM, no extra runtime dependency beyond
`typescript` (the parser). Keep the scanner zero-config: it must run on a loose file
without a `tsconfig` or installed project.
