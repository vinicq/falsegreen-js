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

## C18 — sensitive equality on a stringified value (low, J2)

```ts
expect(String(user)).toBe("[object Object]");   // flagged
expect(`${date}`).toBe("Mon Jan 01 2024");       // flagged
```
Checks the formatting, not the value. A repr change breaks it with no real defect. Clean:
`expect(user.name).toBe("Ana")`.

## C21 — every assertion is conditional (low, J1)

```ts
test("x", () => { if (ready) { expect(a).toBe(b); } }); // flagged: may run zero times
```
Clean: at least one assertion runs unconditionally.

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

## JS7 — assertion in a non-awaited callback (low, J1)

```ts
test("x", () => { setTimeout(() => { expect(a).toBe(b); }, 10); }); // flagged
promise.then(() => expect(x).toBe(y));                              // flagged (not awaited)
```
The assertion may run after the test resolves; a failure becomes an unhandled error, not a
red test. Suppressed when the file uses fake timers. Clean: `await` the promise, or use the
`done` callback.

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

## JS17 — commented-out test block (low, J1)

```ts
// it("logs in", () => { expect(login()).toBe(true); });   // flagged
```
A disabled test that no longer runs and no longer shows up as skipped. Also matches
`it.skip`/`it.only`/`it.each` in a comment. Restore it or delete it.

## JS18 — done callback instead of async/await (low, J1)

```ts
it("loads", (done) => { fetchData().then((d) => { expect(d).toBe(1); done(); }); }); // flagged
```
A `done` called too early, or inside a floating promise, lets the test pass before the
assertions run. Clean: make the test `async` and `await` the work.

## JS21 — matcher referenced but never called (high, J1)

```ts
expect(user.name).toBe;                       // flagged: no (), the matcher never runs
```
The assertion object is built and dropped; nothing executes. Also fires through a
`.resolves`/`.rejects` chain. Clean: call the matcher, `expect(user.name).toBe("Ana")`.

## JS22 — empty it.each/test.each table (high, J1)

```ts
it.each([])("case %s", (n) => { expect(f(n)).toBe(n); });   // flagged: zero cases
```
An empty table generates no cases, so the test is collected but never runs. Clean: populate
the table, or remove the `.each`.

---

## A note on API tests

`request(app).get("/users").expect(200)` (supertest / chai-http) is recognized as an
assertion: `.expect()` throws on a mismatch, so an API integration test built this way is
not mistaken for C2b (calls but checks nothing).

---

## Out of scope

Style, naming, size, duplication, and React production-code smells are not detected. The
semantic patterns (the expected value contradicts the intended behavior; the test
re-implements the production logic) need intent and belong to
[falsegreen-skill](https://github.com/vinicq/falsegreen-skill), the LLM pass.
