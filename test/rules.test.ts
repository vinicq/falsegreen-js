import { describe, it, expect } from "vitest";
import { parse } from "../src/parse.js";
import { analyze } from "../src/rules.js";
import { isTestFile } from "../src/scan.js";

function codes(src: string, file = "x.test.ts"): string[] {
  return analyze(parse(file, src)).map((f) => f.code);
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

  it("JS7: assertion inside a non-awaited setTimeout callback", () => {
    expect(codes(`test("x", () => { setTimeout(() => { expect(a).toBe(b); }, 10); });`)).toContain("JS7");
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

  it("C23: hard-coded URL (mystery guest)", () => {
    expect(codes(`test("x", () => { const r = fetch("https://api.example.com/u"); expect(r).toBeDefined(); });`)).toContain("C23");
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

  it("clean test produces no findings", () => {
    const src = `test("greets", () => { expect(greet("Ana")).toBe("hello Ana"); });`;
    expect(codes(src)).toEqual([]);
  });
});
