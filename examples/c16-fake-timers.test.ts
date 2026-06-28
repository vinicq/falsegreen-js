// falsegreen-js examples - C16 time-controlled look-alike.
//
// A whole file that installs fake timers suppresses C16: time is frozen, so a
// new Date() read is deterministic. This is the CLEAN counterpart to the BAD
// clock reads in nondeterminism.test.ts. The single token that flips the
// verdict is the vi.useFakeTimers() install below.

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// CLEAN: under frozen time, reading the clock is reproducible - no C16.
test("c16 frozen clock clean", () => {
  vi.setSystemTime(new Date("2026-01-01"));
  const t = new Date();
  expect(t.getUTCFullYear()).toBe(2026);
});
