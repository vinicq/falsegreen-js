import { describe, it, expect } from "vitest";
import { parse } from "../src/parse.js";
import { analyze } from "../src/rules.js";
import { isTestFile, effectiveConf } from "../src/scan.js";

function codes(src: string, file = "x.test.ts"): string[] {
  return analyze(parse(file, src)).map((f) => f.code);
}

function detail(src: string, code: string, file = "x.test.ts"): string | undefined {
  return analyze(parse(file, src)).find((f) => f.code === code)?.detail;
}

describe("falsegreen-js rules", () => {
  it("C2: empty test body", () => {
    expect(codes(`test("nothing", () => {});`)).toContain("C2");
  });

  it("C2b: calls but never asserts", () => {
    expect(codes(`test("x", () => { doThing(1); compute(); });`)).toContain("C2b");
  });

  it("C5: always-true literal comparison", () => {
    expect(codes(`test("x", () => { expect(true).toBe(true); });`)).toContain("C5");
  });

  it("C7: self-compare", () => {
    expect(codes(`test("x", () => { expect(user.id).toBe(user.id); });`)).toContain("C7");
  });

  it("C8: exact float equality", () => {
    expect(codes(`test("x", () => { expect(total).toBe(0.3); });`)).toContain("C8");
  });

  it("C16: Math.random without seed", () => {
    expect(codes(`test("x", () => { const r = Math.random(); expect(r).toBeLessThan(1); });`)).toContain("C16");
  });

  it("C16: new Date() with no argument reads the clock", () => {
    expect(codes(`test("x", () => { const t = new Date(); expect(t.getFullYear()).toBe(2026); });`)).toContain("C16");
  });

  it("does not flag C16 for new Date(<literal>) (a fixed instant)", () => {
    expect(codes(`test("x", () => { const t = new Date(0); expect(t.getTime()).toBe(0); });`)).not.toContain("C16");
  });

  it("does not flag C16 for new Date(<string>) or new Date(<expr>) (a fixed instant)", () => {
    expect(codes(`test("x", () => { const t = new Date("2020-01-01"); expect(t.getUTCFullYear()).toBe(2020); });`)).not.toContain("C16");
    expect(codes(`test("x", () => { const t = new Date(ms); expect(t).toBeDefined(); });`)).not.toContain("C16");
  });

  it("C16: crypto.randomUUID without a seed", () => {
    expect(codes(`test("x", () => { const id = crypto.randomUUID(); expect(id).toHaveLength(36); });`)).toContain("C16");
  });

  it("C16: crypto.getRandomValues without a seed", () => {
    expect(codes(`test("x", () => { const b = crypto.getRandomValues(new Uint8Array(4)); expect(b).toBeDefined(); });`)).toContain("C16");
  });

  it("does not flag C16 broadened sources when fake timers are installed", () => {
    expect(codes(`beforeEach(() => { vi.useFakeTimers(); });\ntest("x", () => { const t = new Date(); expect(t).toBeDefined(); });`)).not.toContain("C16");
  });

  it("does not flag C16 for a user method named randomUUID (not crypto-rooted)", () => {
    expect(codes(`test("x", () => { const id = uuidGen.randomUUID(); expect(id).toBe("abc"); });`)).not.toContain("C16");
  });

  it("C16: bare randomUUID() (node:crypto import) without a seed", () => {
    expect(codes(`import { randomUUID } from "node:crypto";\ntest("x", () => { const id = randomUUID(); expect(id).toHaveLength(36); });`)).toContain("C16");
  });

  it("C16: performance.now() reads the clock", () => {
    expect(codes(`test("x", () => { const t = performance.now(); expect(t).toBeGreaterThan(0); });`)).toContain("C16");
  });

  it("JS1: focused test it.only", () => {
    expect(codes(`it.only("x", () => { expect(1).toBe(1); });`)).toContain("JS1");
  });

  it("JS2: expect with no matcher", () => {
    expect(codes(`test("x", () => { expect(result); });`)).toContain("JS2");
  });

  it("JS3: snapshot is the only assertion", () => {
    expect(codes(`test("x", () => { expect(tree).toMatchSnapshot(); });`)).toContain("JS3");
  });

  it("JS4: skipped test", () => {
    expect(codes(`it.skip("x", () => { expect(1).toBe(2); });`)).toContain("JS4");
  });

  it("JS5: findBy without await (Testing Library)", () => {
    const src = `test("x", async () => { screen.findByText("hi"); expect(true).toBe(false); });`;
    expect(codes(src)).toContain("JS5");
  });

  it("JS5: userEvent action not awaited", () => {
    const src = `test("x", async () => { userEvent.click(btn); expect(true).toBe(false); });`;
    expect(codes(src)).toContain("JS5");
  });

  it("does not flag an awaited findBy", () => {
    const src = `test("x", async () => { await screen.findByText("hi"); expect(true).toBe(false); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("does not flag a returned findBy", () => {
    const src = `test("x", async () => { return screen.findByText("hi"); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("does not flag an assigned findBy", () => {
    const src = `test("x", async () => { const el = screen.findByText("hi"); expect(el).toBeTruthy(); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("does not flag a void-discarded findBy (author intent)", () => {
    const src = `test("x", async () => { void screen.findByText("hi"); expect(true).toBe(false); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("JS5: findBy under a || still floats the promise", () => {
    const src = `test("x", async () => { screen.findByText("Saved") || expect(x).toBe(1); });`;
    expect(codes(src)).toContain("JS5");
  });

  it("JS5: floating expect(p).resolves.toBe without await", () => {
    expect(codes(`test("x", () => { expect(fetchUser()).resolves.toBe(1); });`)).toContain("JS5");
  });

  it("JS5: floating expect(p).rejects.toThrow without await", () => {
    expect(codes(`test("x", () => { expect(boom()).rejects.toThrow(); });`)).toContain("JS5");
  });

  it("does not flag JS5 for an awaited expect(p).resolves", () => {
    expect(codes(`test("x", async () => { await expect(fetchUser()).resolves.toBe(1); });`)).not.toContain("JS5");
  });

  it("does not flag JS5 for a returned expect(p).rejects", () => {
    expect(codes(`test("x", () => { return expect(boom()).rejects.toThrow(); });`)).not.toContain("JS5");
  });

  it("does not flag JS5 for a synchronous expect (no resolves/rejects)", () => {
    expect(codes(`test("x", () => { expect(value()).toBe(1); });`)).not.toContain("JS5");
  });

  it("emits exactly one JS5 for a floating expect(p).resolves (no double-report)", () => {
    const fired = codes(`test("x", () => { expect(fetchUser()).resolves.toBe(1); });`);
    expect(fired.filter((c) => c === "JS5")).toHaveLength(1);
  });

  it("JS5: findBy compared with === still floats the promise", () => {
    const src = `test("x", async () => { screen.findByText("Saved") === ready; expect(true).toBe(false); });`;
    expect(codes(src)).toContain("JS5");
  });

  it("does not flag a real-assignment findBy (compound +=)", () => {
    const src = `test("x", async () => { let p; p = screen.findByText("hi"); expect(true).toBe(false); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("does not flag an awaited findBy on the RHS of an assignment", () => {
    const src = `test("x", async () => { let x; x = await screen.findByText("hi"); expect(true).toBe(false); });`;
    expect(codes(src)).not.toContain("JS5");
  });

  it("jest-dom matcher counts as an assertion (no C2b)", () => {
    const src = `test("x", () => { render(<App/>); expect(screen.getByRole("button")).toBeInTheDocument(); });`;
    expect(codes(src, "a.test.tsx")).not.toContain("C2b");
  });

  it("JS6: empty describe block", () => {
    expect(codes(`describe("group", () => {});`)).toContain("JS6");
  });

  it("JS9: assertion in if(false) dead branch", () => {
    expect(codes(`test("x", () => { if (false) { expect(1).toBe(2); } });`)).toContain("JS9");
  });

  it("JS11: try/catch swallows the assertion", () => {
    expect(codes(`test("x", () => { try { expect(a).toBe(b); } catch (e) {} });`)).toContain("JS11");
  });

  it("does not flag try/catch when the assertion is in the catch", () => {
    const src = `test("x", () => { try { run(); } catch (e) { expect(e.message).toBe("boom"); } });`;
    expect(codes(src)).not.toContain("JS11");
  });

  it("CC: commented-out assertion", () => {
    expect(codes(`test("x", () => {\n  // expect(value).toBe(42);\n  run();\n});`)).toContain("CC");
  });

  it("parses TSX without error and still flags", () => {
    const src = `import React from "react";\ntest("renders", () => { render(<App/>); });`;
    expect(codes(src, "comp.test.tsx")).toContain("C2b");
  });

  it("C18: compares stringified form to a literal", () => {
    expect(codes(`test("x", () => { expect(String(user)).toBe("[object Object]"); });`)).toContain("C18");
  });

  it("C21: every assertion is conditional", () => {
    expect(codes(`test("x", () => { if (ready) { expect(a).toBe(b); } });`)).toContain("C21");
  });

  it("does not flag C21 when an assertion runs unconditionally", () => {
    const src = `test("x", () => { expect(a).toBe(b); if (ready) { expect(c).toBe(d); } });`;
    expect(codes(src)).not.toContain("C21");
  });

  it("JS7 timer arm: assertion in an unflushed setTimeout callback", () => {
    const src = `test("x", () => { setTimeout(() => { expect(a).toBe(b); }, 10); });`;
    expect(codes(src)).toContain("JS7");
    expect(detail(src, "JS7")).toMatch(/deferred into setTimeout/);
  });

  it("JS7 timer arm: not flagged when timers are faked/flushed", () => {
    // install BEFORE the arm, or flush AFTER it, in the same test callback.
    const jest = `test("x", () => { jest.useFakeTimers(); setTimeout(() => { expect(a).toBe(b); }, 10); jest.runAllTimers(); });`;
    const vi = `test("x", () => { vi.useFakeTimers(); setTimeout(() => { expect(a).toBe(b); }, 10); });`;
    const sinon = `test("x", () => { const c = sinon.useFakeTimers(); setTimeout(() => { expect(a).toBe(b); }, 10); c.tick(10); });`;
    expect(codes(jest)).not.toContain("JS7");
    expect(codes(vi)).not.toContain("JS7");
    expect(codes(sinon)).not.toContain("JS7");
  });

  it("JS7 timer arm: flush BEFORE the arm still flags (callback never ran)", () => {
    const src = `test("x", () => { jest.runAllTimers(); setTimeout(() => { expect(x).toBe(1); }, 10); });`;
    expect(codes(src)).toContain("JS7");
  });

  it("JS7 timer arm: flush AFTER the arm is not flagged", () => {
    const src = `test("x", () => { setTimeout(() => { expect(x).toBe(1); }, 10); jest.runAllTimers(); });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: install before + flush after is not flagged", () => {
    const src = `test("x", () => { jest.useFakeTimers(); setTimeout(() => { expect(x).toBe(1); }, 10); jest.runAllTimers(); });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: a flush in another test does not suppress this one", () => {
    const src = [
      `test("a", () => { jest.useFakeTimers(); setTimeout(() => { expect(a).toBe(b); }, 10); jest.runAllTimers(); });`,
      `test("b", () => { setTimeout(() => { expect(x).toBe(1); }, 10); });`,
    ].join("\n");
    // test b has no flush/install in its own callback, so it stays flagged.
    expect(codes(src).filter((c) => c === "JS7")).toHaveLength(1);
  });

  it("JS7 timer arm: install in beforeEach hook controls the timer (not flagged)", () => {
    const src = `describe("s", () => {
      beforeEach(() => { jest.useFakeTimers(); });
      afterEach(() => { jest.runAllTimers(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });
    });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: flush in afterAll hook controls the timer (not flagged)", () => {
    const src = `describe("s", () => {
      afterAll(() => { jest.runOnlyPendingTimers(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });
    });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: install in an enclosing outer describe's beforeAll controls it", () => {
    const src = `describe("outer", () => {
      beforeAll(() => { vi.useFakeTimers(); });
      describe("inner", () => {
        it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });
      });
    });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: top-level beforeEach install (outside any describe) controls it", () => {
    // Top-level hooks wrap every test in the file, so an install there drives the timer.
    const src = `beforeEach(() => { jest.useFakeTimers(); });
      afterEach(() => { jest.runAllTimers(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: top-level afterEach flush (outside any describe) controls it", () => {
    const src = `afterEach(() => { jest.runOnlyPendingTimers(); });
      test("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });`;
    expect(codes(src)).not.toContain("JS7");
  });

  it("JS7 timer arm: top-level beforeEach without timer call still flags", () => {
    // a top-level hook that does not touch fake timers must not suppress JS7.
    const src = `beforeEach(() => { setup(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });`;
    expect(codes(src)).toContain("JS7");
  });

  it("JS7 timer arm: no hook control and no in-test flush still flags", () => {
    const src = `describe("s", () => {
      beforeEach(() => { setup(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });
    });`;
    expect(codes(src)).toContain("JS7");
  });

  it("JS7 timer arm: flush in beforeEach (wrong hook kind) does not control it", () => {
    // a flush only helps when it runs AFTER the test body — i.e. in a teardown hook.
    const src = `describe("s", () => {
      beforeEach(() => { jest.runAllTimers(); });
      it("x", () => { setTimeout(() => { expect(a).toBe(1); }, 0); });
    });`;
    expect(codes(src)).toContain("JS7");
  });

  it("JS7 promise arm: assertion in a floating .then", () => {
    const src = `test("x", () => { load().then(() => { expect(a).toBe(b); }); });`;
    expect(codes(src)).toContain("JS7");
    expect(detail(src, "JS7")).toMatch(/floating \.then\(\)/);
  });

  it("JS7 promise arm: not flagged when the chain is returned or awaited", () => {
    const returned = `test("x", () => { return load().then(() => { expect(a).toBe(b); }); });`;
    const awaited = `test("x", async () => { await load().then(() => { expect(a).toBe(b); }); });`;
    expect(codes(returned)).not.toContain("JS7");
    expect(codes(awaited)).not.toContain("JS7");
  });

  it("custom assertion helper (util.assertEqual) is not C2b", () => {
    const src = `test("x", () => { util.assertEqual<A, B>(true); });`;
    expect(codes(src)).not.toContain("C2b");
  });

  it("does not flag commented prose in JSDoc as CC", () => {
    const src = `/**\n * assert that the value is valid\n */\ntest("x", () => { expect(a).toBe(b); });`;
    expect(codes(src)).not.toContain("CC");
  });

  it("C9: toThrow without an error type or message", () => {
    expect(codes(`test("x", () => { expect(() => run()).toThrow(); });`)).toContain("C9");
  });

  it("C37: duplicate case in it.each", () => {
    const src = `it.each([[1, 2], [1, 2]])("adds %i", (a, b) => { expect(a).toBe(b); });`;
    expect(codes(src)).toContain("C37");
  });

  it("JS13: loose RTL query never asserted", () => {
    expect(codes(`test("x", () => { screen.getByText("Save"); });`)).toContain("JS13");
  });

  it("diagnostic group is emitted by analyze (D1/D3/D6/D7/M2)", () => {
    expect(codes(`test("", () => { console.log(1); expect(a).toBe(1); expect(a).toBe(1); });`))
      .toEqual(expect.arrayContaining(["D7", "D6", "D3"]));
  });

  it("D4: it.each without titled cases", () => {
    const src = `it.each([[1], [2]])("runs", (a) => { expect(a).toBeDefined(); });`;
    expect(codes(src)).toContain("D4");
  });

  it("JS15: inappropriate assertion (comparison wrapped in a boolean)", () => {
    expect(codes(`test("x", () => { expect(a === b).toBe(true); });`)).toContain("JS15");
  });

  it("does not flag a direct value assertion as JS15", () => {
    expect(codes(`test("x", () => { expect(a).toBe(b); });`)).not.toContain("JS15");
  });

  it("D8: magic number in an assertion (diagnostic)", () => {
    expect(codes(`test("x", () => { expect(total).toBe(4096); });`)).toContain("D8");
  });

  it("JS5: Vue flushPromises not awaited", () => {
    expect(codes(`test("x", async () => { flushPromises(); expect(a).toBe(b); });`)).toContain("JS5");
  });

  it("does not flag awaited flushPromises", () => {
    expect(codes(`test("x", async () => { await flushPromises(); expect(a).toBe(b); });`)).not.toContain("JS5");
  });

  it("JS13: Vue Test Utils findComponent as a loose statement", () => {
    expect(codes(`test("x", () => { wrapper.findComponent(Button); });`)).toContain("JS13");
  });

  it("JS13: Vue wrapper.find with a selector as a loose statement", () => {
    expect(codes(`test("x", () => { wrapper.find(".btn"); });`)).toContain("JS13");
  });

  it("does not flag Array.find (callback arg) as JS13", () => {
    expect(codes(`test("x", () => { items.find(i => i.id === 1); expect(items).toHaveLength(2); });`)).not.toContain("JS13");
  });

  it("discovers test files across JS/TS naming conventions", () => {
    expect(isTestFile("cypress/e2e/login.cy.ts")).toBe(true);   // Cypress
    expect(isTestFile("src/Button.cy.tsx")).toBe(true);
    expect(isTestFile("tests/auth.spec.ts")).toBe(true);        // Jest/Vitest/Playwright
    expect(isTestFile("src/mod_test.ts")).toBe(true);           // Deno
    expect(isTestFile("src/userSpec.js")).toBe(true);           // Jasmine
    expect(isTestFile("e2e/checkout.e2e-spec.ts")).toBe(true);  // Angular/Protractor
    expect(isTestFile("app.e2e.ts")).toBe(true);                // WebdriverIO
    expect(isTestFile("src/utils.ts")).toBe(false);             // not a test
    expect(isTestFile("src/respec.ts")).toBe(false);            // not a false match
  });

  describe("assertion vocabulary across tools (no false C2b)", () => {
    it("Chai expect().to.equal", () => {
      expect(codes(`test("x", () => { service.run(); expect(user).to.equal(admin); });`)).not.toContain("C2b");
    });
    it("Chai should", () => {
      expect(codes(`test("x", () => { service.run(); user.should.equal(admin); });`)).not.toContain("C2b");
    });
    it("TestCafe t.expect().eql", () => {
      expect(codes(`test("x", async t => { await t.click(btn); await t.expect(el.innerText).eql("ok"); });`)).not.toContain("C2b");
    });
    it("jest-axe toHaveNoViolations", () => {
      const src = `test("a11y", async () => { render(<App/>); expect(await axe(container)).toHaveNoViolations(); });`;
      expect(codes(src, "a.test.tsx")).not.toContain("C2b");
    });
  });

  it("JS3: visual snapshot only (Playwright toHaveScreenshot)", () => {
    expect(codes(`test("looks right", async () => { await expect(page).toHaveScreenshot(); });`)).toContain("JS3");
  });

  it("C6: weak check (toBeTruthy on a real value)", () => {
    expect(codes(`test("x", () => { const r = compute(); expect(r).toBeTruthy(); });`)).toContain("C6");
  });

  it("C6: only-not-empty (length > 0)", () => {
    expect(codes(`test("x", () => { expect(items.length).toBeGreaterThan(0); });`)).toContain("C6");
  });

  it("C20: assertion in dead code after return", () => {
    expect(codes(`test("x", () => { doThing(); return; expect(a).toBe(b); });`)).toContain("C20");
  });

  // --- C20 via structured reachability (cfg.ts) ----------------------------
  it("C20: both arms of an if terminate, so the assertion after is dead", () => {
    expect(codes(`test("x", () => { if (k) { return; } else { throw e; } expect(a).toBe(b); });`)).toContain("C20");
  });

  it("C20: assertion after process.exit is dead", () => {
    expect(codes(`test("x", () => { process.exit(1); expect(a).toBe(b); });`)).toContain("C20");
  });

  it("C20: assertion after a terminating block is dead", () => {
    expect(codes(`test("x", () => { { doThing(); return; } expect(a).toBe(b); });`)).toContain("C20");
  });

  it("C20: assertion after break in a loop body is dead", () => {
    expect(codes(`test("x", () => { for (const x of xs) { break; expect(x).toBe(1); } });`)).toContain("C20");
  });

  it("C20: assertion after an exhaustive switch (every case + default escapes) is dead", () => {
    expect(codes(`test("x", () => { switch (k) { case 1: return 1; default: throw e; } expect(a).toBe(b); });`)).toContain("C20");
  });

  it("does not flag C20 for an assertion after a loop (the loop may run zero times)", () => {
    expect(codes(`test("x", () => { for (const x of xs) { doThing(x); } expect(a).toBe(b); });`)).not.toContain("C20");
  });

  it("does not flag C20 for an assertion after a conditional return without else", () => {
    expect(codes(`test("x", () => { if (k) return; expect(a).toBe(b); });`)).not.toContain("C20");
  });

  it("does not flag C20 when the return is inside a nested callback (forEach), not the test", () => {
    expect(codes(`test("x", () => { xs.forEach((x) => { return; }); expect(a).toBe(b); });`)).not.toContain("C20");
  });

  it("does not flag C20 for a switch without a default (a no-match falls through)", () => {
    expect(codes(`test("x", () => { switch (k) { case 1: return 1; } expect(a).toBe(b); });`)).not.toContain("C20");
  });

  // --- C20 owns a dead-code-only assertion; C21 must not also fire (#62) ----
  it("C20 owns a dead-code-only assertion: C21 does not also fire", () => {
    const c = codes(`test("x", () => { switch (k) { case 1: return; expect(a).toBe(b); } });`);
    expect(c).toContain("C20");
    expect(c).not.toContain("C21");
  });

  it("C21 still fires when a live conditional assertion remains alongside a dead top-level one", () => {
    // The trailing assertion is dead (after the unconditional return) so it raises C20;
    // the guarded one is live but conditional, so C21 must still fire. The dead assertion
    // must not mask C21 by reading as a guaranteed spine assertion (#62).
    const c = codes(`test("x", () => { if (j) { expect(a).toBe(b); } return; expect(c).toBe(d); });`);
    expect(c).toContain("C20");
    expect(c).toContain("C21");
  });

  // --- #63 characterization: cfg loop/switch/IIFE/labeled-break edge cases ---
  it("does not flag C20 for an assertion after a for-in loop (may run zero times)", () => {
    expect(codes(`test("x", () => { for (const k in obj) { doThing(k); } expect(a).toBe(b); });`)).not.toContain("C20");
  });

  it("C21: the only assertion lives in a for-in loop body", () => {
    expect(codes(`test("x", () => { for (const k in obj) { expect(obj[k]).toBe(1); } });`)).toContain("C21");
  });

  it("C20: assertion after a labeled break-to-outer is dead in the inner block", () => {
    expect(codes("test(\"x\", () => { outer: { break outer; expect(a).toBe(b); } });")).toContain("C20");
  });

  it("does not flag C20 for an assertion after a switch case that falls through without escaping", () => {
    expect(codes(`test("x", () => { switch (k) { case 1: doThing(); case 2: expect(a).toBe(b); } });`)).not.toContain("C20");
  });

  it("does not flag C21 for the only assertion held in an IIFE that runs unconditionally", () => {
    // An immediately-invoked function runs once at the test top level; its assertion is
    // not behind a condition. FP-averse: must not be a phantom C21.
    expect(codes(`test("x", () => { (() => { expect(a).toBe(b); })(); });`)).not.toContain("C21");
  });

  // --- C21 via structured reachability (cfg.ts) ----------------------------
  it("C21: the only assertion lives in a catch block", () => {
    expect(codes(`test("x", () => { try { doThing(); } catch (e) { expect(a).toBe(b); } });`)).toContain("C21");
  });

  it("C21: the only assertion lives in a loop body", () => {
    expect(codes(`test("x", () => { for (const x of xs) { expect(x).toBe(1); } });`)).toContain("C21");
  });

  it("does not flag C21 for an assertion in an if(true) branch", () => {
    expect(codes(`test("x", () => { if (true) { expect(a).toBe(b); } });`)).not.toContain("C21");
  });

  it("does not flag C21 for an assertion in a finally block (always runs)", () => {
    expect(codes(`test("x", () => { try { doThing(); } finally { expect(a).toBe(b); } });`)).not.toContain("C21");
  });

  it("does not flag C21 for an assertion in a do/while body (runs at least once)", () => {
    expect(codes(`test("x", () => { do { expect(a).toBe(b); } while (c); });`)).not.toContain("C21");
  });

  it("C21: a do/while with only a conditional assertion still fires", () => {
    expect(codes(`test("x", () => { do { noop(); } while (c); if (k) { expect(a).toBe(b); } });`)).toContain("C21");
  });

  it("does not flag C21 for an assertion on the try spine", () => {
    expect(codes(`test("x", () => { try { expect(a).toBe(b); } catch (e) {} });`)).not.toContain("C21");
  });

  it("does not flag C21 for an unconditional chai/Cypress fluent assertion (result.should.equal)", () => {
    expect(codes(`test("x", () => { result.should.equal(1); });`)).not.toContain("C21");
  });

  it("C21: a guarded .should fluent assertion still fires", () => {
    expect(codes(`test("x", () => { if (k) { result.should.equal(1); } });`)).toContain("C21");
  });

  it("C23: hard-coded URL (mystery guest)", () => {
    expect(codes(`test("x", () => { const r = fetch("https://api.example.com/u"); expect(r).toBeDefined(); });`)).toContain("C23");
  });

  it("C23: axios.get with a hard-coded URL still fires", () => {
    expect(codes(`test("x", () => { const r = axios.get("https://api.example.com/u"); expect(r).toBeDefined(); });`)).toContain("C23");
  });

  it("C23: cache.get with a url-shaped key does not fire (not an HTTP client)", () => {
    expect(codes(`test("x", () => { const r = cache.get("http://key/thing"); expect(r).toBeDefined(); });`)).not.toContain("C23");
  });

  it("C23: redis.get with a url-shaped key does not fire", () => {
    expect(codes(`test("x", () => { const r = redis.get("https://k/v"); expect(r).toBeDefined(); });`)).not.toContain("C23");
  });

  // --- C48: dark patch (test flips a test-mode flag then asserts) ----------
  it("C48: sets process.env.NODE_ENV=test then asserts", () => {
    expect(codes(`test("x", () => { process.env.NODE_ENV = "test"; expect(feature()).toBe("ok"); });`)).toContain("C48");
  });

  it("C48: sets process.env.TESTING then asserts", () => {
    expect(codes(`test("x", () => { process.env.TESTING = "1"; expect(run()).toBe(1); });`)).toContain("C48");
  });

  it("C48: process.env[\"TEST_MODE\"] bracket form then asserts", () => {
    expect(codes(`test("x", () => { process.env["TEST_MODE"] = "true"; expect(run()).toBe(1); });`)).toContain("C48");
  });

  it("C48: module/settings flag settings.TESTING=true then asserts", () => {
    expect(codes(`test("x", () => { settings.TESTING = true; expect(run()).toBe(1); });`)).toContain("C48");
  });

  it("does not flag C48 for a config value (DATABASE_URL)", () => {
    expect(codes(`test("x", () => { process.env.DATABASE_URL = "sqlite://"; expect(run()).toBe(1); });`)).not.toContain("C48");
  });

  it("does not flag C48 for NODE_ENV set to production", () => {
    expect(codes(`test("x", () => { process.env.NODE_ENV = "production"; expect(run()).toBe(1); });`)).not.toContain("C48");
  });

  it("does not flag C48 for a product feature flag", () => {
    expect(codes(`test("x", () => { settings.FEATURE_X = true; expect(run()).toBe(1); });`)).not.toContain("C48");
  });

  it("does not flag C48 when the flag write has no assertion after it", () => {
    expect(codes(`test("x", () => { process.env.TESTING = "1"; doSetup(); });`)).not.toContain("C48");
  });

  it("does not flag C48 when the assertion comes before the toggle", () => {
    expect(codes(`test("x", () => { expect(run()).toBe(1); process.env.TESTING = "1"; });`)).not.toContain("C48");
  });

  it("does not flag C48 for this.TESTING (instance state)", () => {
    expect(codes(`test("x", function () { this.TESTING = true; expect(run()).toBe(1); });`)).not.toContain("C48");
  });

  it("C23: reads a real file at a literal path", () => {
    expect(codes(`test("x", () => { const d = readFileSync("/var/data/fixture.json"); expect(d).toBe(1); });`)).toContain("C23");
  });

  it("JS8: mocks the unit under test and asserts it directly", () => {
    const src = `import { calc } from "./calc";\njest.mock("./calc");\ntest("x", () => { expect(calc(2)).toBe(4); });`;
    expect(codes(src)).toContain("JS8");
  });

  it("does not flag JS8 when mocking a dependency, not the SUT", () => {
    const src = `import { calc } from "./calc";\njest.mock("./db");\ntest("x", () => { expect(calc(2)).toBe(4); });`;
    expect(codes(src)).not.toContain("JS8");
  });

  // --- C44: numeric tautology (parity with falsegreen) --------------------

  it("C44: a direct length >= 0 is always true", () => {
    expect(codes(`test("x", () => { expect(items.length).toBeGreaterThanOrEqual(0); });`)).toContain("C44");
  });

  it("does not flag C44 on a meaningful length bound (look-alike)", () => {
    // length >= 1 / > 0 can be false on an empty array — a real check, not a tautology.
    expect(codes(`test("x", () => { expect(items.length).toBeGreaterThanOrEqual(1); });`)).not.toContain("C44");
    expect(codes(`test("x", () => { expect(items.length).toBeGreaterThan(0); });`)).not.toContain("C44");
  });

  it("does not flag C44 on a difference of lengths (can be negative)", () => {
    // a derived expression that only mentions .length is not the direct subject.
    const src = `test("x", () => { expect(actual.length - expected.length).toBeGreaterThanOrEqual(0); });`;
    expect(codes(src)).not.toContain("C44");
  });

  it("does not flag C44 on a finiteness/NaN guard (false for NaN and Infinity)", () => {
    // these can be false (NaN beats no bound), so they are meaningful guards, not tautologies.
    expect(codes(`test("x", () => { expect(score).toBeLessThan(Infinity); });`)).not.toContain("C44");
    expect(codes(`test("x", () => { expect(score).toBeGreaterThan(-Infinity); });`)).not.toContain("C44");
  });

  // --- codes added from the consolidated catalog (Lote 1 + Lote 2) ---------

  it("JS21: matcher referenced but never called", () => {
    expect(codes(`test("x", () => { expect(user.name).toBe; });`)).toContain("JS21");
  });

  it("JS21: fires through a .resolves chain", () => {
    expect(codes(`test("x", async () => { expect(p()).resolves.toBeDefined; });`)).toContain("JS21");
  });

  it("does not flag JS21 when the matcher is called", () => {
    expect(codes(`test("x", () => { expect(user.name).toBe("Ana"); });`)).not.toContain("JS21");
  });

  it("JS22: empty it.each table", () => {
    expect(codes(`it.each([])("case %s", (n) => { expect(f(n)).toBe(n); });`)).toContain("JS22");
  });

  it("does not flag JS22 when the each table has rows", () => {
    expect(codes(`it.each([1,2])("case %s", (n) => { expect(f(n)).toBe(n); });`)).not.toContain("JS22");
  });

  it("JS17: commented-out test block", () => {
    expect(codes(`// it("logs in", () => { expect(login()).toBe(true); });`)).toContain("JS17");
  });

  it("JS17: commented-out it.skip is still flagged", () => {
    expect(codes(`// it.skip("later", () => {});`)).toContain("JS17");
  });

  it("JS18: done callback instead of async/await", () => {
    expect(codes(`it("x", (done) => { expect(v).toBe(1); done(); });`)).toContain("JS18");
  });

  it("does not flag JS18 for a normal callback", () => {
    expect(codes(`it("x", () => { expect(v).toBe(1); });`)).not.toContain("JS18");
  });

  it("recognizes supertest .expect() as an assertion (API integration, no C2b)", () => {
    const src = `test("GET /users", async () => { await request(app).get("/users").expect(200); });`;
    expect(codes(src)).not.toContain("C2b");
  });

  it("recognizes a returned supertest chain (implicit-return arrow)", () => {
    const src = `test("GET /users", () => request(app).get("/users").expect(200));`;
    expect(codes(src)).not.toContain("C2b");
  });

  it("still flags a floating (non-awaited) supertest request as C2b", () => {
    const src = `test("GET /users", () => { request(app).get("/users").expect(200); });`;
    expect(codes(src)).toContain("C2b");
  });

  it("does not flag JS22 for a plain helper .each over an empty array", () => {
    const src = `test("x", () => { _.each([], fn); expect(run()).toBe(1); });`;
    expect(codes(src)).not.toContain("JS22");
  });

  // --- JS23: expect.assertions(N) with too few unconditional expect calls ----
  it("JS23: expect.assertions(2) but only one unconditional expect runs", () => {
    const src = `test("x", async () => { expect.assertions(2); expect(a).toBe(b); });`;
    expect(codes(src)).toContain("JS23");
  });

  it("does not flag JS23 when the count matches the unconditional expect calls", () => {
    const src = `test("x", async () => { expect.assertions(2); expect(a).toBe(1); expect(b).toBe(2); });`;
    expect(codes(src)).not.toContain("JS23");
  });

  it("does not flag JS23 when the missing expect calls sit in a loop (count indeterminate)", () => {
    const src = `test("x", async () => { expect.assertions(2); expect(a).toBe(1); for (const x of xs) { expect(x).toBe(1); } });`;
    expect(codes(src)).not.toContain("JS23");
  });

  it("does not flag JS23 for expect.hasAssertions() (no count)", () => {
    const src = `test("x", async () => { expect.hasAssertions(); expect(a).toBe(1); });`;
    expect(codes(src)).not.toContain("JS23");
  });

  it("does not flag JS23 when assertions are delegated to a helper (count indeterminate)", () => {
    const src = `function assertUserShape(u){ expect(u.id).toBeDefined(); expect(u.name).toBeDefined(); }\ntest("user", async () => { expect.assertions(2); const u = await fetchUser(); assertUserShape(u); });`;
    expect(codes(src)).not.toContain("JS23");
  });

  // --- JS24: Cypress query chain with no terminating assertion ----------------
  it("JS24: cy.get used as a statement with no .should/.then", () => {
    expect(codes(`it("x", () => { cy.get(".btn"); });`, "login.cy.ts")).toContain("JS24");
  });

  it("does not flag JS24 when the chain ends in .should", () => {
    expect(codes(`it("x", () => { cy.get(".btn").should("be.visible"); });`, "login.cy.ts")).not.toContain("JS24");
  });

  it("does not flag JS24 when the chain asserts in .then", () => {
    expect(codes(`it("x", () => { cy.get(".btn").then(($el) => { expect($el).to.exist(); }); });`, "login.cy.ts")).not.toContain("JS24");
  });

  it("does not flag JS24 for an action command (cy.click)", () => {
    expect(codes(`it("x", () => { cy.get(".btn").click(); });`, "login.cy.ts")).not.toContain("JS24");
  });

  // --- JS8 spyOn form (#48) ---------------------------------------------------
  it("JS8: spyOn the SUT with a canned return then assert it directly", () => {
    const src = `test("x", () => { jest.spyOn(svc, "fetch").mockReturnValue(42); expect(svc.fetch()).toBe(42); });`;
    expect(codes(src)).toContain("JS8");
  });

  it("does not flag JS8 when spying a collaborator, not the asserted subject", () => {
    const src = `test("x", () => { jest.spyOn(db, "read").mockReturnValue(1); expect(svc.run()).toBe(2); });`;
    expect(codes(src)).not.toContain("JS8");
  });

  it("does not flag JS8 when asserting on the spy handle itself", () => {
    const src = `test("x", () => { const spy = jest.spyOn(svc, "fetch").mockReturnValue(1); svc.fetch(); expect(spy).toHaveBeenCalled(); });`;
    expect(codes(src)).not.toContain("JS8");
  });

  it("does not flag JS8 spyOn across different test bodies (test-local scope)", () => {
    const src = `test("A", () => { jest.spyOn(svc, "fetch").mockReturnValue(42); doSomething(); });\ntest("B", () => { expect(svc.compute()).toBe(7); });`;
    expect(codes(src)).not.toContain("JS8");
  });

  // --- JS25 assertion only inside an array-iterator callback (#71) ------------
  it("JS25: the only assertion is inside a forEach callback", () => {
    expect(codes(`test("x", () => { items.forEach((i) => expect(i).toBe(1)); });`)).toContain("JS25");
  });

  it("JS25: also fires for map/some/every/flatMap callbacks", () => {
    expect(codes(`test("x", () => { rows.map((r) => expect(r).toBeDefined()); });`)).toContain("JS25");
  });

  it("does not flag JS25 when an own-scope assertion runs unconditionally", () => {
    expect(codes(`test("x", () => { expect(items.length).toBe(2); items.forEach((i) => expect(i).toBe(1)); });`)).not.toContain("JS25");
  });

  it("does not flag JS25 when the receiver is a non-empty array literal", () => {
    expect(codes(`test("x", () => { [1, 2].forEach((i) => expect(i).toBeGreaterThan(0)); });`)).not.toContain("JS25");
  });

  it("does not flag JS25 when an expect.assertions guard is present", () => {
    expect(codes(`test("x", () => { expect.assertions(2); items.forEach((i) => expect(i).toBe(1)); });`)).not.toContain("JS25");
  });

  // --- JS30 literal-vs-literal assertion (#72) --------------------------------
  it("JS30: two different literals through an equality matcher", () => {
    expect(codes(`test("x", () => { expect(2).toBe(3); });`)).toContain("JS30");
  });

  it("JS30: chai expect(lit).to.equal(lit)", () => {
    expect(codes(`test("x", () => { expect("a").to.equal("b"); });`)).toContain("JS30");
  });

  it("does not flag JS30 when the subject is a real value (one token away)", () => {
    expect(codes(`test("x", () => { expect(compute()).toBe(3); });`)).not.toContain("JS30");
  });

  it("does not flag JS30 for object literals (reference equality, false-red)", () => {
    expect(codes(`test("x", () => { expect({ a: 1 }).toEqual({ a: 2 }); });`)).not.toContain("JS30");
  });

  // --- JS31 try/catch swallows a SUT throw (#73) ------------------------------
  it("JS31: try calls code, empty catch swallows the throw", () => {
    expect(codes(`test("x", () => { try { callUnit(); } catch (e) {} });`)).toContain("JS31");
  });

  it("does not flag JS31 when the catch asserts on the exception", () => {
    expect(codes(`test("x", () => { try { callUnit(); } catch (e) { expect(e).toBeInstanceOf(Error); } });`)).not.toContain("JS31");
  });

  it("does not flag JS31 when the catch re-throws", () => {
    expect(codes(`test("x", () => { try { callUnit(); } catch (e) { throw e; } });`)).not.toContain("JS31");
  });

  it("does not flag JS31 when the try has no call (nothing to swallow)", () => {
    expect(codes(`test("x", () => { try { const x = 1; } catch (e) {} });`)).not.toContain("JS31");
  });

  // --- JS27 toHaveBeenCalled* as the sole oracle (#74) ------------------------
  it("JS27: the only oracle is toHaveBeenCalled on a local double", () => {
    expect(codes(`test("x", () => { const fn = jest.fn(); run(fn); expect(fn).toHaveBeenCalled(); });`)).toContain("JS27");
  });

  it("does not flag JS27 when the unit output is also asserted", () => {
    expect(codes(`test("x", () => { const fn = jest.fn(); const r = run(fn); expect(fn).toHaveBeenCalled(); expect(r).toBe(2); });`)).not.toContain("JS27");
  });

  it("does not flag JS27 when the call-tracking subject is not a local double", () => {
    expect(codes(`test("x", () => { run(logger); expect(logger.log).toHaveBeenCalled(); });`)).not.toContain("JS27");
  });

  // --- JS26 fake timers installed but never advanced (#75) --------------------
  it("JS26: fake timers installed, setTimeout armed, never advanced", () => {
    expect(codes(`test("x", () => { vi.useFakeTimers(); let v = 0; setTimeout(() => { v = 1; }, 100); expect(v).toBe(0); });`)).toContain("JS26");
  });

  it("does not flag JS26 when the timers are advanced before asserting", () => {
    expect(codes(`test("x", () => { vi.useFakeTimers(); let v = 0; setTimeout(() => { v = 1; }, 100); vi.runAllTimers(); expect(v).toBe(1); });`)).not.toContain("JS26");
  });

  // --- JS29 resolves/rejects not awaited or returned (#76) --------------------
  it("JS29: a bare expect(...).resolves chain is not awaited", () => {
    expect(codes(`test("x", () => { expect(p).resolves.toBe(1); });`)).toContain("JS29");
  });

  it("does not flag JS29 when the resolves chain is awaited", () => {
    expect(codes(`test("x", async () => { await expect(p).resolves.toBe(1); });`)).not.toContain("JS29");
  });

  it("does not flag JS29 when the rejects chain is returned", () => {
    expect(codes(`test("x", () => { return expect(p).rejects.toThrow(); });`)).not.toContain("JS29");
  });

  // --- C8b toBeCloseTo without a precision argument (#77) ---------------------
  it("C8b: toBeCloseTo with no precision argument", () => {
    expect(codes(`test("x", () => { expect(total).toBeCloseTo(0.3); });`)).toContain("C8b");
  });

  it("does not flag C8b when an explicit precision is passed", () => {
    expect(codes(`test("x", () => { expect(total).toBeCloseTo(0.3, 5); });`)).not.toContain("C8b");
  });

  // --- C11a self-confirming literal (#77) -------------------------------------
  it("C11a: expected is bound from the same call under test", () => {
    expect(codes(`test("x", () => { const expected = foo(); expect(foo()).toBe(expected); });`)).toContain("C11a");
  });

  it("does not flag C11a when the expected value is an independent literal", () => {
    expect(codes(`test("x", () => { const expected = 42; expect(foo()).toBe(expected); });`)).not.toContain("C11a");
  });

  it("does not flag C11a when the expected value comes from a different call", () => {
    expect(codes(`test("x", () => { const expected = bar(); expect(foo()).toBe(expected); });`)).not.toContain("C11a");
  });

  // --- JS3 inline-snapshot refinement (#50) -----------------------------------
  it("JS3: empty inline snapshot carries the self-writing detail", () => {
    const src = `test("x", () => { expect(tree).toMatchInlineSnapshot(); });`;
    expect(detail(src, "JS3")).toMatch(/writing itself/);
  });

  it("JS3: a populated inline snapshot keeps the plain snapshot detail", () => {
    const src = "test(\"x\", () => { expect(tree).toMatchInlineSnapshot(`<div />`); });";
    expect(detail(src, "JS3")).toBe("the only assertion is a snapshot");
  });

  // --- #49 --enable / --disable precedence (effectiveConf) --------------------
  it("--enable flips a default-off code on at its catalog severity", () => {
    expect(effectiveConf("D8", {})).toBe("off");
    expect(effectiveConf("D8", { cliEnable: new Set(["D8"]) })).toBe("low");
  });

  it("--disable wins over --enable (a code both enabled and disabled stays off)", () => {
    const opts = { cliEnable: new Set(["D8"]), cliDisable: new Set(["D8"]) };
    expect(effectiveConf("D8", opts)).toBe("off");
  });

  it("clean test produces no findings", () => {
    const src = `test("greets", () => { expect(greet("Ana")).toBe("hello Ana"); });`;
    expect(codes(src)).toEqual([]);
  });

  // --- field-validation precision fixes (#82) ---------------------------------

  // JS30: literal-vs-literal still fires on the plain over-firing shape, but the
  // force-fail-in-asserting-catch idiom and the inner-expect-under-matcher case go
  // quiet (the inner expect is the unit under test, not a dead oracle).
  it("JS30: a plain literal-vs-literal expect still fires", () => {
    expect(codes(`it("x", () => { expect(1).toBe(2); });`)).toContain("JS30");
  });

  it("does not flag JS30 for the force-fail shape inside a try whose catch asserts on the error", () => {
    const src = `it("x", () => { try { f(); expect(true).toBe(false); } catch (e) { expect(e.message).toMatch(/boom/); } });`;
    expect(codes(src)).not.toContain("JS30");
  });

  it("does not flag JS30 when the inner expect is the subject of an enclosing matcher", () => {
    const src = `it("x", () => { expect(() => expect(1).toBe(2)).toThrow(); });`;
    expect(codes(src)).not.toContain("JS30");
  });

  it("does not flag JS30 for a literal-vs-literal expect inside a skipped block", () => {
    expect(codes(`xit("x", () => { expect(1).toBe(2); });`)).not.toContain("JS30");
  });

  // JS31: still fires when the catch swallows a parse-call throw with no oracle, but
  // goes quiet when the test has an unconditional assertion outside an incidental-IO try.
  it("JS31: try parses config, empty catch swallows, no outside oracle", () => {
    expect(codes(`it("x", () => { try { parseConfig(bad); } catch (e) {} });`)).toContain("JS31");
  });

  it("does not flag JS31 when an unconditional assertion runs outside an incidental-IO try", () => {
    const src = `it("x", async () => { try { fs.writeFileSync(p, t); } catch (e) {}; await expect(page.locator("h1")).toBeVisible(); });`;
    expect(codes(src)).not.toContain("JS31");
  });

  // JS25: a param-typed receiver still fires; a const-bound non-empty array literal
  // receiver is proven to run the callback at least once and goes quiet.
  it("JS25: forEach over a parameter receiver still fires", () => {
    expect(codes(`it("x", () => { items.forEach((i) => expect(i).toBeTruthy()); });`)).toContain("JS25");
  });

  it("does not flag JS25 when the receiver is bound to a non-empty array literal", () => {
    const src = `it("x", () => { const cases = [1, 2, 3]; cases.forEach((c) => expect(c).toBeGreaterThan(0)); });`;
    expect(codes(src)).not.toContain("JS25");
  });

  it("JS25 const-binding guard does not disturb it.each/describe.each tables", () => {
    expect(codes(`it.each([])("x", () => { expect(1).toBe(1); });`)).not.toContain("JS25");
  });

  // JS27: a weak call-counter still fires; a CalledWith carrying real args is a
  // behavioral oracle and goes quiet.
  it("JS27: a bare toHaveBeenCalled on a local double still fires", () => {
    expect(codes(`it("x", () => { const s = jest.fn(); run(s); expect(s).toHaveBeenCalled(); });`)).toContain("JS27");
  });

  it("does not flag JS27 when the oracle is toHaveBeenCalledWith carrying args", () => {
    const src = `it("x", () => { const s = jest.fn(); submit(s, { a: 1 }); expect(s).toHaveBeenCalledWith({ a: 1 }); });`;
    expect(codes(src)).not.toContain("JS27");
  });

  it("JS27: toHaveBeenNthCalledWith with only the call index is still a bare counter", () => {
    // arg 0 of NthCalledWith is the call INDEX, not a value, so a lone index asserts
    // only that an Nth call happened — the call-counter JS27 targets.
    expect(codes(`it("x", () => { const s = jest.fn(); run(s); expect(s).toHaveBeenNthCalledWith(1); });`)).toContain("JS27");
  });

  it("does not flag JS27 when toHaveBeenNthCalledWith carries an argument value past the index", () => {
    const src = `it("x", () => { const s = jest.fn(); run(s); expect(s).toHaveBeenNthCalledWith(1, "x"); });`;
    expect(codes(src)).not.toContain("JS27");
  });


  // C16: a fixed setTimeout delay is deterministic and no longer flagged; Math.random
  // (and the rest of the clock/crypto family) still fires.
  it("C16: Math.random in a test still fires", () => {
    expect(codes(`it("x", () => { const r = Math.random(); expect(r).toBeLessThan(1); });`)).toContain("C16");
  });

  it("does not flag C16 for a fixed setTimeout delay (deterministic, not nondeterminism)", () => {
    const src = `it("x", async () => { await new Promise((r) => setTimeout(r, 0)); expect(state).toBe("done"); });`;
    expect(codes(src)).not.toContain("C16");
  });

  // C21: a for loop with a literal integer bound runs its body at least once, so the
  // only assertion is unconditional and C21 does not fire.
  it("does not flag C21 for the only assertion in a literal-bounded for loop", () => {
    const src = `it("x", () => { for (let i = 0; i < 3; i++) { expect(i).toBeGreaterThanOrEqual(0); } });`;
    expect(codes(src)).not.toContain("C21");
  });

  it("C21 still fires when the for bound is not a literal (loop may run zero times)", () => {
    expect(codes(`it("x", () => { for (let i = 0; i < n; i++) { expect(i).toBeGreaterThanOrEqual(0); } });`)).toContain("C21");
  });
});

