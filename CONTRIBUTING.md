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

## Commit and PR

- Small, focused commits. Reference the issue.
- Run build + test + self-scan before opening the PR.
- The PR template lists the checklist.

## Code style

Match the surrounding code. TypeScript, ESM, no extra runtime dependency beyond
`typescript` (the parser). Keep the scanner zero-config: it must run on a loose file
without a `tsconfig` or installed project.
