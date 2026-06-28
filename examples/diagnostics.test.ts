// falsegreen-js examples - diagnostic group (maintainability; OFF by default).
//
// Codes: D1, D3, D4, D6, D7, D8, M2
//
// These are NOT false-green: the test still protects something. They flag test
// health, so they are off by default and surface only with --diagnostics (or
// --enable for a single code). A plain scan reports none of these; the CLEAN
// look-alikes stay quiet even when the group is enabled. The scanner reads the
// syntax tree only; it never runs this file.

// --- D1: assertion roulette (many assertions, none with a message) -----------

// BAD: when one fails, the output does not say which.
test("d1 roulette", () => {
  expect(subtotal()).toBe(30);
  expect(discount()).toBe(3);
  expect(shipping()).toBe(5);
  expect(tax()).toBe(2);
  expect(total()).toBe(40);
});

// CLEAN: a single assertion is never roulette.
test("d1 single clean", () => { expect(total()).toBe(40); });

// --- D3: duplicate assert ----------------------------------------------------

// BAD: the same assertion appears twice; the repeat adds no coverage.
test("d3 duplicate", () => {
  const u = createUser("ana");
  expect(u.email).toBe("ana@example.com");
  expect(u.active).toBe(true);
  expect(u.email).toBe("ana@example.com");
});

// CLEAN: each assertion checks something distinct.
test("d3 distinct clean", () => { expect(a()).toBe(1); expect(b()).toBe(2); });

// --- D4: it.each without titled cases ----------------------------------------

// BAD: a failing case is identified only by its index.
it.each([[1], [2]])("d4 runs", (n) => { expect(n).toBeDefined(); });

// CLEAN: titled cases name each row.
it.each`
  n
  ${1}
  ${2}
`("d4 case $n clean", ({ n }) => { expect(n).toBeLessThan(3); });

// --- D6: console.* in a test body --------------------------------------------

// BAD: a debug print left behind, suppressed by the runner, just noise.
test("d6 debug print", () => { const r = compute(); console.log(r); expect(r).toBe(42); });

// CLEAN: no stray console call.
test("d6 quiet clean", () => { expect(compute()).toBe(42); });

// --- D7: anonymous test (empty description) ----------------------------------

// BAD: an empty title gives the failure report nothing to name.
test("", () => { expect(compute()).toBe(42); });

// CLEAN: a descriptive title.
test("d7 named clean", () => { expect(compute()).toBe(42); });

// --- D8: magic number in an assertion ----------------------------------------

// BAD: a bare numeric literal instead of a named constant.
test("d8 magic number", () => { expect(total).toBe(4096); });

// CLEAN: a named constant carries the intent.
test("d8 named constant clean", () => { expect(total).toBe(MAX_BUFFER); });

// --- M2: long test body (RiskGroup: structure) -------------------------------

// CLEAN: M2 fires on a body longer than the threshold (default 50 lines). A
// long body would only add noise here, so this file shows the focused
// alternative - one concern per test. Enable M2 and tune the threshold to flag
// the long form in your own suite.
test("m2 focused name clean", () => { expect(createUser("ana").name).toBe("ana"); });
test("m2 focused role clean", () => { expect(createUser("ana").role).toBe("guest"); });
