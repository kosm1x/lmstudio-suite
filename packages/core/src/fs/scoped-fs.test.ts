import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScopedFs, PathEscapeError } from "./scoped-fs";

let dir: string;
let fs: ScopedFs;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scoped-fs-"));
  fs = new ScopedFs(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ScopedFs path guard", () => {
  it("rejects parent-directory traversal", () => {
    expect(() => fs.resolvePath("../escape.txt")).toThrow(PathEscapeError);
    expect(() => fs.resolvePath("a/b/../../../escape")).toThrow(
      PathEscapeError,
    );
  });

  it("rejects absolute paths that escape the root", () => {
    expect(() => fs.resolvePath("/etc/passwd")).toThrow(PathEscapeError);
  });

  it("allows nested paths inside the root", () => {
    expect(fs.resolvePath("a/b/c.txt")).toBe(join(dir, "a/b/c.txt"));
    expect(fs.resolvePath(".")).toBe(dir);
  });

  it("does not confuse a sibling dir with a matching prefix", () => {
    // `<root>-evil` shares the string prefix of `<root>` but is outside it.
    expect(() => fs.resolvePath("../" + "evil")).toThrow(PathEscapeError);
  });
});

describe("ScopedFs operations", () => {
  it("writes, reads, lists, checks existence, and removes", async () => {
    await fs.writeFile("notes/a.txt", "hello");
    expect(await fs.exists("notes/a.txt")).toBe(true);
    expect(await fs.readFile("notes/a.txt")).toBe("hello");
    expect(await fs.list("notes")).toEqual([{ name: "a.txt", type: "file" }]);
    await fs.remove("notes/a.txt");
    expect(await fs.exists("notes/a.txt")).toBe(false);
  });

  it("truncates reads larger than maxReadBytes", async () => {
    const small = new ScopedFs(dir, { maxReadBytes: 4 });
    await small.writeFile("big.txt", "abcdefgh");
    const out = await small.readFile("big.txt");
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("truncated");
  });

  it("refuses to remove the root", async () => {
    await expect(fs.remove(".")).rejects.toThrow(/root directory/);
  });
});
