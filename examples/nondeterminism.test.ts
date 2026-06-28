// falsegreen-js examples - RiskGroup: nondeterminism (passes or fails by luck:
// time, randomness, timers).
//
// Code: C16
//
// This file must NOT install fake timers: C16 is suppressed file-wide for any
// file whose text mentions a fake-timer install or flush call (the
// time-controlled look-alike lives in c16-fake-timers.test.ts, which does
// install them). The scanner reads the syntax tree only; it never runs this
// file.

// --- C16: Math.random with no seed -------------------------------------------

// BAD: the result rides on an unseeded random draw.
test("c16 math random", () => { const r = Math.random(); expect(r).toBeLessThan(1); });

// CLEAN: a fixed input is deterministic.
test("c16 fixed input clean", () => { expect(double(21)).toBe(42); });

// --- C16: new Date() reads the system clock ----------------------------------

// BAD: new Date() with no argument depends on when the test runs.
test("c16 new date", () => { const t = new Date(); expect(t.getFullYear()).toBe(2026); });

// CLEAN: a fixed instant (a literal argument) is deterministic.
test("c16 fixed instant clean", () => { const t = new Date(0); expect(t.getTime()).toBe(0); });

// --- C16: crypto.randomUUID with no seed -------------------------------------

// BAD: a fresh UUID changes every run.
test("c16 random uuid", () => { const id = crypto.randomUUID(); expect(id).toHaveLength(36); });

// CLEAN: a fixed expected id.
test("c16 fixed id clean", () => { expect(slugify("Hello World")).toBe("hello-world"); });

// --- C16: performance.now() reads the clock ----------------------------------

// BAD: the elapsed reading is nondeterministic.
test("c16 performance now", () => { const t = performance.now(); expect(t).toBeGreaterThan(0); });

// CLEAN: assert a computed duration from fixed inputs.
test("c16 fixed duration clean", () => { expect(elapsed(10, 30)).toBe(20); });
