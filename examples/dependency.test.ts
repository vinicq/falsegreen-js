// falsegreen-js examples - RiskGroup: dependency (real I/O, or a stand-in for
// the unit under test: a mystery guest).
//
// Codes: C23, JS27
//
// The scanner reads the syntax tree only; it never runs this file.

// --- C23: hard-coded URL (mystery guest) -------------------------------------

// BAD: the test hits a real network host at a literal URL.
test("c23 hardcoded url", () => { const r = fetch("https://api.example.com/u"); expect(r).toBeDefined(); });

// CLEAN: assert a pure transform, no network.
test("c23 no network clean", () => { expect(buildUrl("u")).toBe("/api/u"); });

// --- C23: reads a real file at a literal path --------------------------------

// BAD: the test reads a fixed absolute path on the machine.
test("c23 real file path", () => { const d = readFileSync("/var/data/fixture.json"); expect(d).toBe(1); });

// CLEAN: parse an in-memory literal instead of reading the disk.
test("c23 in memory clean", () => { expect(parse('{"id":1}')).toEqual({ id: 1 }); });

// --- JS27: toHaveBeenCalled* as the sole oracle ------------------------------

// BAD: the only check is that the local double was called, not the unit output.
test("js27 sole call oracle", () => { const fn = jest.fn(); run(fn); expect(fn).toHaveBeenCalled(); });

// CLEAN: assert the unit's output as well as the call.
test("js27 also output clean", () => { const fn = jest.fn(); const r = run(fn); expect(fn).toHaveBeenCalled(); expect(r).toBe(2); });
