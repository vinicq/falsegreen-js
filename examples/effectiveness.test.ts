// falsegreen-js examples - RiskGroup: effectiveness (no oracle, a trivial
// oracle, or the wrong oracle).
//
// Codes: C2, C2b, C5, C6, C7, C8, C9, C18, C37, C44, JS3, JS13, JS15
//
// Each BAD test is one the scanner flags; each CLEAN look-alike is one token
// away and stays quiet. The scanner reads the syntax tree, it never runs this
// file: the helpers it calls (compute, greet, ...) do not exist on purpose.
// vitest is told to ignore examples/ (see vitest.config.ts), so this file is a
// scan target, not a runnable suite.

// --- C2: empty test body -----------------------------------------------------

// BAD: the body proves only that nothing threw.
test("c2 empty body", () => {});

// CLEAN: a real assertion on a returned value.
test("c2 asserts result clean", () => { expect(greet("Ana")).toBe("hello Ana"); });

// --- C2b: calls things, checks nothing ---------------------------------------

// BAD: the result is computed and discarded.
test("c2b discards result", () => { doThing(1); compute(); });

// CLEAN: assert the result of the call.
test("c2b asserts clean", () => { expect(compute()).toBe(42); });

// --- C5: always-true literal comparison --------------------------------------

// BAD: expect(true).toBe(true) passes no matter what the code does.
test("c5 always true", () => { expect(true).toBe(true); });

// CLEAN: compare a real value to an independent expected one.
test("c5 real value clean", () => { expect(compute()).toBe(42); });

// --- C6: weak check (only that something came back) --------------------------

// BAD: toBeTruthy on a real result accepts any non-falsy value.
test("c6 truthy", () => { const r = compute(); expect(r).toBeTruthy(); });

// BAD: length > 0 only proves the list is non-empty.
test("c6 only not empty", () => { expect(items.length).toBeGreaterThan(0); });

// CLEAN: assert the actual value.
test("c6 exact clean", () => { expect(compute()).toBe(42); });

// --- C7: compares a thing to itself ------------------------------------------

// BAD: both sides are the same expression.
test("c7 self compare", () => { expect(user.id).toBe(user.id); });

// CLEAN: compare against an independent expected value.
test("c7 independent clean", () => { expect(user.id).toBe(1); });

// --- C8: exact equality on a float -------------------------------------------

// BAD: floating-point rounding makes the exact match brittle.
test("c8 float exact", () => { expect(total).toBe(0.3); });

// CLEAN: a tolerance instead of exact float equality.
test("c8 close to clean", () => { expect(total).toBeCloseTo(0.3); });

// --- C9: toThrow with no error type or message -------------------------------

// BAD: accepts any error, even an unrelated one.
test("c9 bare throw", () => { expect(() => run()).toThrow(); });

// CLEAN: pin the expected error.
test("c9 typed throw clean", () => { expect(() => run()).toThrow("out of range"); });

// --- C18: compares a stringified form to a literal ---------------------------

// BAD: checks the String() formatting, not the value.
test("c18 stringified", () => { expect(String(user)).toBe("[object Object]"); });

// CLEAN: assert the value, not its string form.
test("c18 value clean", () => { expect(user.name).toBe("Ana"); });

// --- C37: duplicate case in it.each ------------------------------------------

// BAD: the [1, 2] row repeats; the second run covers nothing new.
it.each([[1, 2], [1, 2]])("c37 adds %i %i", (a, b) => { expect(a).toBe(b); });

// CLEAN: each row is distinct.
it.each([[1, 2], [3, 4]])("c37 distinct %i %i clean", (a, b) => { expect(a).toBeLessThan(b); });

// --- C44: numeric tautology (length >= 0) ------------------------------------

// BAD: a length is never negative, so the bound is always satisfied.
test("c44 length non negative", () => { expect(items.length).toBeGreaterThanOrEqual(0); });

// CLEAN: assert the exact length, a value that can fail.
test("c44 exact length clean", () => { expect(items.length).toBe(3); });

// --- JS3: a snapshot is the only assertion -----------------------------------

// BAD: the snapshot is generated from the output itself - it checks nothing new.
test("js3 snapshot only", () => { expect(tree).toMatchSnapshot(); });

// CLEAN: a real assertion instead of a self-generated snapshot.
test("js3 real assert clean", () => { expect(render(tree)).toBe("<div>Ana</div>"); });

// --- JS13: a Testing Library query left as a loose statement -----------------

// BAD: the query runs but its result is never asserted.
test("js13 loose query", () => { screen.getByText("Save"); });

// CLEAN: assert on the query result.
test("js13 asserted query clean", () => { expect(screen.getByText("Save")).toBeVisible(); });

// --- JS15: inappropriate assertion (comparison wrapped in a boolean) ----------

// BAD: expect(a===b).toBe(true) hides which side differs on failure.
test("js15 boolean compare", () => { expect(a === b).toBe(true); });

// CLEAN: compare the values directly so the failure message is useful.
test("js15 direct compare clean", () => { expect(a).toBe(b); });
