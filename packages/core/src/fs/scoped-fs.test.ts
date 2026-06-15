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

  it("writeFileIfChanged writes once, then no-ops on identical content", async () => {
    expect(await fs.writeFileIfChanged("a.txt", "v1")).toBe(true); // created
    expect(await fs.writeFileIfChanged("a.txt", "v1")).toBe(false); // unchanged
    expect(await fs.writeFileIfChanged("a.txt", "v2")).toBe(true); // changed
    expect(await fs.readFile("a.txt")).toBe("v2");
  });

  it("writeFileIfChanged compares the FULL file, not the truncated read", async () => {
    // A file longer than the read cap that is unchanged must still no-op.
    const small = new ScopedFs(dir, { maxReadBytes: 4 });
    const big = "x".repeat(64);
    expect(await small.writeFileIfChanged("big.txt", big)).toBe(true);
    expect(await small.writeFileIfChanged("big.txt", big)).toBe(false);
  });

  it("refuses to remove the root", async () => {
    await expect(fs.remove(".")).rejects.toThrow(/root directory/);
  });

  it("moves a file within the root, creating parent dirs", async () => {
    await fs.writeFile("incoming/a.md", "body");
    await fs.move("incoming/a.md", "projects/a.md");
    expect(await fs.exists("incoming/a.md")).toBe(false);
    expect(await fs.readFile("projects/a.md")).toBe("body");
  });

  it("rejects a move that escapes the root on either end", async () => {
    await fs.writeFile("incoming/a.md", "body");
    await expect(fs.move("incoming/a.md", "../escape.md")).rejects.toThrow(
      PathEscapeError,
    );
    await expect(fs.move("../outside.md", "notes/a.md")).rejects.toThrow(
      PathEscapeError,
    );
  });
});

describe("ScopedFs stat", () => {
  it("reports type and size for a file, and type for a dir", async () => {
    await fs.writeFile("a.txt", "hello");
    await fs.mkdir("sub");
    const file = await fs.stat("a.txt");
    expect(file.type).toBe("file");
    expect(file.size).toBe(5);
    expect(typeof file.mtimeMs).toBe("number");
    expect((await fs.stat("sub")).type).toBe("dir");
  });

  it("throws ENOENT for a missing path", async () => {
    await expect(fs.stat("nope.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a stat that escapes the root", async () => {
    await expect(fs.stat("../outside")).rejects.toThrow(PathEscapeError);
  });
});

describe("ScopedFs walk", () => {
  beforeEach(async () => {
    await fs.writeFile("a.txt", "1");
    await fs.writeFile("sub/b.txt", "2");
    await fs.writeFile("sub/deep/c.txt", "3");
    await fs.writeFile("node_modules/pkg/index.js", "ignored");
    await fs.writeFile(".git/config", "ignored");
  });

  const collect = async (rel?: string, ignore?: ReadonlySet<string>) => {
    const out: string[] = [];
    for await (const p of fs.walk(rel, ignore ? { ignore } : {})) out.push(p);
    return out.sort();
  };

  it("yields files recursively as POSIX paths, pruning ignored dirs", async () => {
    expect(await collect()).toEqual(["a.txt", "sub/b.txt", "sub/deep/c.txt"]);
  });

  it("walks a subdirectory", async () => {
    expect(await collect("sub")).toEqual(["sub/b.txt", "sub/deep/c.txt"]);
  });

  it("honors a custom ignore set (empty = include everything)", async () => {
    const out = await collect(".", new Set<string>());
    expect(out).toContain("node_modules/pkg/index.js");
    expect(out).toContain(".git/config");
  });

  it("does not walk into a directory symlink that points outside the root", async () => {
    const { symlink, mkdtemp, writeFile } = await import("node:fs/promises");
    const outside = await mkdtemp(join(tmpdir(), "scoped-fs-outside-"));
    await writeFile(join(outside, "secret.txt"), "TOP SECRET");
    try {
      await symlink(outside, join(dir, "link"), "dir");
    } catch {
      return; // platform without symlink support — skip
    }
    const out = await collect(".", new Set<string>());
    // The symlinked dir is reported as neither file nor dir by readdir, so it
    // is never recursed and the outside file never surfaces.
    expect(out.some((p) => p.includes("secret"))).toBe(false);
    await rm(outside, { recursive: true, force: true });
  });
});
