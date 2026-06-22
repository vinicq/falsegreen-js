import { describe, it, expect } from "vitest";
import { parse } from "../src/parse.js";
import { analyze } from "../src/rules.js";

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

  it("custom assertion helper (util.assertEqual) is not C2b", () => {
    const src = `test("x", () => { util.assertEqual<A, B>(true); });`;
    expect(codes(src)).not.toContain("C2b");
  });

  it("does not flag commented prose in JSDoc as CC", () => {
    const src = `/**\n * assert that the value is valid\n */\ntest("x", () => { expect(a).toBe(b); });`;
    expect(codes(src)).not.toContain("CC");
  });

  it("clean test produces no findings", () => {
    const src = `test("adds", () => { expect(add(2, 3)).toBe(5); });`;
    expect(codes(src)).toEqual([]);
  });
});
