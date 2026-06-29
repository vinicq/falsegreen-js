// falsegreen-js examples - RiskGroup: execution (the check exists but never
// runs, or the test vanishes from the count).
//
// Codes: C20, C21, CC, C48, JS1, JS2, JS4, JS5, JS6, JS7, JS8, JS9, JS11,
//        JS17, JS18, JS21, JS22, JS23, JS25, JS26, JS29, JS31
//
// BAD tests are flagged; CLEAN look-alikes stay quiet. The scanner reads the
// syntax tree only; it never runs this file (see vitest.config.ts).

import { calc } from "./calc.js";
jest.mock("./calc.js");

// --- C20: assertion in dead code after a return ------------------------------

// BAD: the assertion sits after an unconditional return.
test("c20 dead after return", () => { doThing(); return; expect(a).toBe(b); });

// CLEAN: an early-return guard does not orphan a later assertion.
test("c20 guard clean", () => { if (skip()) return; expect(compute()).toBe(1); });

// --- C21: every assertion is conditional -------------------------------------

// BAD: when ready is false the test checks nothing.
test("c21 all conditional", () => { if (ready) { expect(a).toBe(b); } });

// CLEAN: an assertion that runs unconditionally first.
test("c21 unconditional clean", () => { expect(a).toBe(b); if (ready) { expect(c).toBe(d); } });

// --- CC: commented-out assertion ---------------------------------------------

// BAD: the only check is switched off.
test("cc commented", () => {
  // expect(value).toBe(42);
  run();
});

// CLEAN: the assertion is live.
test("cc live clean", () => { expect(compute()).toBe(42); });

// --- C48: dark patch (flip a test-mode flag, then assert) --------------------

// BAD: forces the product's test-only branch instead of the real path.
test("c48 dark patch", () => { process.env.NODE_ENV = "test"; expect(feature()).toBe("ok"); });

// CLEAN: a real config value is not a test-mode toggle.
test("c48 config clean", () => { process.env.DATABASE_URL = "sqlite://"; expect(run()).toBe(1); });

// --- JS1: focused test silently skips the rest of the suite ------------------

// BAD: it.only runs only this test; the rest never run.
it.only("js1 focused", () => { expect(sum(1, 1)).toBe(2); });

// CLEAN: a plain test does not focus.
it("js1 not focused clean", () => { expect(sum(1, 1)).toBe(2); });

// --- JS2: expect with no matcher ---------------------------------------------

// BAD: expect(result) never executes an assertion.
test("js2 no matcher", () => { expect(result); });

// CLEAN: a matcher makes the assertion run.
test("js2 matcher clean", () => { expect(result).toBe("ok"); });

// --- JS4: skipped test never runs --------------------------------------------

// BAD: it.skip is collected but skipped.
it.skip("js4 skipped", () => { expect(broken()).toBe("fixed"); });

// CLEAN: a live test.
it("js4 live clean", () => { expect(sum(1, 1)).toBe(2); });

// --- JS5: async query not awaited --------------------------------------------

// BAD: findByText returns a promise that is never awaited.
test("js5 floating findby", async () => { screen.findByText("hi"); expect(loaded).toBe(true); });

// CLEAN: await the query before asserting.
test("js5 awaited clean", async () => { await screen.findByText("hi"); expect(loaded).toBe(true); });

// --- JS6: empty describe block -----------------------------------------------

// BAD: the suite reports green but runs nothing.
describe("js6 empty group", () => {});

// CLEAN: a describe block with a test inside.
describe("js6 full group clean", () => { it("runs", () => { expect(sum(1, 1)).toBe(2); }); });

// --- JS7: assertion in a non-awaited setTimeout callback ---------------------

// BAD: the callback may fire after the test ends.
test("js7 timer", () => { setTimeout(() => { expect(a).toBe(b); }, 10); });

// CLEAN: fake timers, armed then flushed in the same body.
test("js7 faked clean", () => { vi.useFakeTimers(); setTimeout(() => { expect(a).toBe(b); }, 10); vi.runAllTimers(); });

// --- JS8: mocks the unit under test, then asserts it directly ----------------

// BAD: calc is the SUT and it is mocked, so the test checks the mock.
test("js8 mocks the sut", () => { expect(calc(2)).toBe("four"); });

// CLEAN: spying a collaborator (db), asserting the real subject (svc).
test("js8 collaborator clean", () => { jest.spyOn(db, "read").mockReturnValue("row"); expect(svc.run()).toBe("done"); });

// --- JS9: assertion in a dead branch (if(false)) -----------------------------

// BAD: the if(false) body never executes.
test("js9 dead branch", () => { if (false) { expect(broken()).toBe("fixed"); } });

// CLEAN: a live branch with an unconditional assertion alongside it.
test("js9 live branch clean", () => { expect(base()).toBe("a"); if (flag) { expect(extra()).toBe("b"); } });

// --- JS11: try/catch swallows the assertion ----------------------------------

// BAD: a failing expect is caught, the test stays green.
test("js11 swallowed", () => { try { expect(a).toBe(b); } catch (e) {} });

// CLEAN: the assertion is in the catch, checking the caught error; the spine
// also asserts unconditionally, so it is not merely conditional either.
test("js11 assert in catch clean", () => {
  expect(setup()).toBe("ready");
  try { run(); } catch (e) { expect(e.message).toBe("boom"); }
});

// --- JS17: commented-out test block ------------------------------------------

// BAD: a disabled test that no longer runs.
// it("js17 logs in", () => { expect(login()).toBe(true); });

// CLEAN: a live test (no commented-out block).
it("js17 live clean", () => { expect(login()).toBe(true); });

// --- JS18: done callback instead of async/await ------------------------------

// BAD: done can be called before the assertions run.
it("js18 done callback", (done) => { expect(v).toBe(1); done(); });

// CLEAN: async/await instead of done.
it("js18 async clean", async () => { expect(await v()).toBe(1); });

// --- JS21: matcher referenced but never called -------------------------------

// BAD: toBe with no () never executes the assertion.
test("js21 uncalled matcher", () => { expect(user.name).toBe; });

// CLEAN: the matcher is called.
test("js21 called clean", () => { expect(user.name).toBe("Ana"); });

// --- JS22: empty it.each table -----------------------------------------------

// BAD: zero rows, so the test is generated with no cases.
it.each([])("js22 case %s", (n) => { expect(f(n)).toBe(n); });

// CLEAN: a populated table with a real comparison.
it.each([[1, 2], [2, 3]])("js22 case %i clean", (n, next) => { expect(n + 1).toBe(next); });

// --- JS23: expect.assertions(N) with too few unconditional expects -----------

// BAD: claims 2 assertions but only one runs unconditionally.
test("js23 too few", async () => { expect.assertions(2); expect(a).toBe(b); });

// CLEAN: the count matches the unconditional expect calls.
test("js23 count matches clean", async () => { expect.assertions(2); expect(a).toBe(c); expect(b).toBe(d); });

// --- JS25: assertion only inside an array-iterator callback ------------------

// BAD: on an empty collection the callback never runs and nothing is checked.
test("js25 forEach only", () => { items.forEach((i) => expect(i).toBe(1)); });

// CLEAN: an own-scope assertion runs even when the collection is empty.
test("js25 own assert clean", () => { expect(items.length).toBe(2); items.forEach((i) => expect(i).toBe(1)); });

// --- JS26: fake timers installed but never advanced --------------------------

// BAD: the scheduled callback never fires, so the assertion reads initial state.
test("js26 never advanced", () => { vi.useFakeTimers(); let v = 0; setTimeout(() => { v = 1; }, 100); expect(v).toBe(0); });

// CLEAN: advancing the timers fires the callback before the assertion.
test("js26 advanced clean", () => { vi.useFakeTimers(); let v = 0; setTimeout(() => { v = 1; }, 100); vi.runAllTimers(); expect(v).toBe(1); });

// --- JS29: resolves/rejects not awaited or returned --------------------------

// BAD: a bare resolves chain settles after the test reports green.
test("js29 floating resolves", () => { expect(p).resolves.toBe(1); });

// CLEAN: awaiting the chain makes the matcher settle inside the test.
test("js29 awaited clean", async () => { await expect(p).resolves.toBe(1); });

// --- JS31: try/catch swallows a SUT throw ------------------------------------

// BAD: a unit that stops throwing still passes; the catch checks nothing.
test("js31 swallowed throw", () => { try { callUnit(); } catch (e) {} });

// CLEAN: the catch asserts on the caught exception.
test("js31 asserts on error clean", () => { try { callUnit(); } catch (e) { expect(e).toBeInstanceOf(Error); } });
