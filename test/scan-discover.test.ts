import { describe, it, expect, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

// A dir that passes statSync but throws EACCES on readdirSync (the real failure
// mode #88 item 1 fixes) must not abort the whole scan. chmod is unreliable for
// read perms on Windows, so the unreadable dir is simulated by making
// readdirSync throw for that one path while every other fs call is the real one.
const root = path.join(os.tmpdir(), "fgjs-disc-fixture");
const good = path.join(root, "good.test.ts");
const sub = path.join(root, "sub");

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    statSync: ((p: import("node:fs").PathLike, ...rest: unknown[]) => {
      // Report `sub` as a real directory (so walk descends into it) without
      // touching the filesystem; everything else stats for real.
      if (String(p) === sub) return { isFile: () => false, isDirectory: () => true } as import("node:fs").Stats;
      if (String(p) === root) return { isFile: () => false, isDirectory: () => true } as import("node:fs").Stats;
      return (actual.statSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.statSync,
    readdirSync: ((p: import("node:fs").PathLike, ...rest: unknown[]) => {
      if (String(p) === sub) {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      if (String(p) === root) {
        return [
          { name: "good.test.ts", isDirectory: () => false, isFile: () => true },
          { name: "sub", isDirectory: () => true, isFile: () => false },
        ] as unknown as import("node:fs").Dirent[];
      }
      return (actual.readdirSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof actual.readdirSync,
  };
});

const { discover } = await import("../src/scan.js");

describe("discover() resilience to an unreadable directory (#88 item 1)", () => {
  it("skips a dir that throws on readdir and still returns the readable files", () => {
    let result: string[] = [];
    expect(() => { result = discover([root]); }).not.toThrow();
    expect(result).toEqual([good]);
  });
});
