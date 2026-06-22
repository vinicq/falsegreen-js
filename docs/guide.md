# falsegreen-js guide

One question per test: **is there a way for the code to be wrong and this test to stay
green?** If yes, the test is not protecting what it claims. This guide explains each code
with a flagged example and a clean look-alike. The scanner reads the AST only; it never
runs the code.

Confidence: **high** blocks (exit 20), **low** warns (exit 10). Judgments J1-J6 are shared
with [falsegreen-skill](https://github.com/vinicq/falsegreen-skill):
J1 does the assertion run? · J2 is the oracle independent? · J3 real unit or a stand-in? ·
J4 enough, and the right thing? · J5 coupled to internals? · J6 passes in isolation?

---

## C2 — empty test body (high, J1)

```ts
test("creates a user", () => {});           // flagged: nothing runs
```
Clean: a body with a real assertion.

## C2b — calls things but checks nothing (low, J1)

```ts
test("saves", () => { service.save(user); }); // flagged: no assertion
```
Clean: `expect(service.save(user)).toBe(true)`. Any assertion vocabulary counts (Jest,
chai `.to`, `assert`, AVA `t.is`, `.should`), so a Mocha or AVA test is not mistaken.

## C5 — always-true check (high, J2)

```ts
expect(true).toBe(true);                    // flagged
assert(1);                                  // flagged
```
A constant on both sides can never fail. Clean: `expect(result).toBe(true)`.

## C7 — compares a thing to itself (high, J2)

```ts
expect(user.id).toBe(user.id);              // flagged: tautology
```
Clean: `expect(user.id).toBe(42)`. A call on a side is not flagged (`f()` may differ).

## C8 — exact equality on a float (low, J4)

```ts
expect(total).toBe(0.1 + 0.2);              // flagged: rounding, not a bug
```
Clean: `expect(total).toBeCloseTo(0.3)`.

## C16 — depends on time/randomness/timer (low, J1)

```ts
const r = Math.random();                    // flagged
const t = Date.now();                       // flagged
```
Suppressed when the file uses fake timers (`useFakeTimers`). Clean: seeded/frozen values.

## CC — commented-out assertion (low, J1)

```ts
// expect(value).toBe(42);                  // flagged: check switched off
```

## JS1 — focused test (high, J1)

```ts
it.only("a", () => { ... });                // flagged: the rest of the suite is skipped
```
Also `fit`, `describe.only`. Clean: no `.only`.

## JS2 — expect with no matcher (high, J1)

```ts
expect(result);                             // flagged: the assertion never executes
```
Clean: `expect(result).toBeDefined()`.

## JS3 — snapshot is the only assertion (low, J2)

```ts
test("renders", () => { expect(tree).toMatchSnapshot(); }); // flagged
```
A snapshot generated from the output confirms it changed, not that it is correct. Clean:
a snapshot alongside a real assertion.

## JS4 — skipped test (low, J1)

```ts
it.skip("a", () => { ... });                // flagged. Also xit, it.todo
```

## JS5 — async query/event not awaited (low, J1)

```ts
screen.findByText("Saved");                 // flagged: promise floats, may never settle
```
Also `waitFor`, `userEvent.*`. Clean: `await screen.findByText("Saved")`.

## JS6 — empty describe/suite (high, J1)

```ts
describe("auth", () => {});                  // flagged: green suite, runs nothing
```

## JS9 — assertion in a dead branch (high, J1)

```ts
if (false) { expect(x).toBe(y); }            // flagged: never runs
```
Only literal conditions are flagged. A real condition (`if (cond)`) is not, on purpose.

## JS11 — try/catch swallows the assertion (low, J1)

```ts
try { expect(a).toBe(b); } catch (e) {}      // flagged: a failing expect is caught
```
Clean: the assertion is in the `catch` (testing an error), or the catch re-throws / calls
`fail()`.

---

## Out of scope

Style, naming, size, duplication, and React production-code smells are not detected. The
semantic patterns (the expected value contradicts the intended behavior; the test
re-implements the production logic) need intent and belong to
[falsegreen-skill](https://github.com/vinicq/falsegreen-skill), the LLM pass.
