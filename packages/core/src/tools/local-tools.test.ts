import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsTools, createShellTool } from "./local-tools";
import type { CommandPolicy } from "../exec/index";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createFsTools>[number]["implementation"]>
>[1];

let root = "";

/** Invoke a named fs tool's implementation against the temp root. */
async function call(
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const t = createFsTools({ root }).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return (await t.implementation(params, ctx)) as string;
}

const read = (rel: string) => fsp.readFile(join(root, rel), "utf8");
const seed = (rel: string, content: string) =>
  fsp.writeFile(join(root, rel), content);

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "local-tools-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("write_file", () => {
  it("writes new content, then reports a no-op on an identical re-write", async () => {
    const first = await call("write_file", { path: "out.md", content: "hi" });
    expect(first).toMatch(/Wrote 2 characters/);

    const again = await call("write_file", { path: "out.md", content: "hi" });
    expect(again).toMatch(/No change/);
    expect(again).toMatch(/do not write it again/);
    expect(await read("out.md")).toBe("hi");

    // Different content writes normally again.
    const changed = await call("write_file", {
      path: "out.md",
      content: "bye",
    });
    expect(changed).toMatch(/Wrote 3 characters/);
  });
});

describe("edit_file", () => {
  it("makes a single exact-string edit", async () => {
    await seed("f.txt", "hello world");
    const r = await call("edit_file", {
      path: "f.txt",
      old_string: "world",
      new_string: "there",
    });
    expect(r).toMatch(/replaced 1 occurrence\b/);
    expect(await read("f.txt")).toBe("hello there");
  });

  it("errors and does not write when old_string is not found", async () => {
    await seed("f.txt", "abc");
    const r = await call("edit_file", {
      path: "f.txt",
      old_string: "zzz",
      new_string: "x",
    });
    expect(r).toMatch(/not found/);
    expect(await read("f.txt")).toBe("abc"); // untouched
  });

  it("refuses an ambiguous match unless replace_all is set", async () => {
    await seed("f.txt", "a a a");
    const r = await call("edit_file", {
      path: "f.txt",
      old_string: "a",
      new_string: "b",
    });
    expect(r).toMatch(/matches 3 times/);
    expect(await read("f.txt")).toBe("a a a"); // untouched
  });

  it("replace_all changes every occurrence", async () => {
    await seed("f.txt", "a a a");
    const r = await call("edit_file", {
      path: "f.txt",
      old_string: "a",
      new_string: "b",
      replace_all: true,
    });
    expect(r).toMatch(/replaced 3 occurrences/);
    expect(await read("f.txt")).toBe("b b b");
  });

  it("treats new_string literally ($ has no special meaning)", async () => {
    await seed("f.txt", "x");
    await call("edit_file", {
      path: "f.txt",
      old_string: "x",
      new_string: "$1$&",
    });
    expect(await read("f.txt")).toBe("$1$&");
  });

  it("rejects identical old/new and empty old_string without writing", async () => {
    await seed("f.txt", "keep");
    expect(
      await call("edit_file", {
        path: "f.txt",
        old_string: "keep",
        new_string: "keep",
      }),
    ).toMatch(/identical/);
    expect(
      await call("edit_file", {
        path: "f.txt",
        old_string: "",
        new_string: "x",
      }),
    ).toMatch(/must not be empty/);
    expect(await read("f.txt")).toBe("keep");
  });

  it("edits a file larger than the 1MB read cap without dropping the tail", async () => {
    // If edit_file used the model-facing (capped) read, "TAIL_MARKER" would sit
    // past the 1MB cut and read as "not found" — and a write-back would truncate
    // the file. This proves the non-truncating readFileFull path is load-bearing.
    const head = "A".repeat(1_200_000);
    await seed("big.txt", `${head}\nTAIL_MARKER`);
    const r = await call("edit_file", {
      path: "big.txt",
      old_string: "TAIL_MARKER",
      new_string: "TAIL_EDITED",
    });
    expect(r).toMatch(/replaced 1 occurrence\b/);
    const after = await read("big.txt");
    expect(after.startsWith(head)).toBe(true); // head intact
    expect(after.endsWith("TAIL_EDITED")).toBe(true); // tail edited, not lost
    expect(after.length).toBe(head.length + 1 + "TAIL_EDITED".length);
  });

  it("rejects a path that escapes the root", async () => {
    const r = await call("edit_file", {
      path: "../escape.txt",
      old_string: "a",
      new_string: "b",
    });
    expect(r).toMatch(/Error:/);
  });
});

describe("search_files", () => {
  it("finds matches across nested dirs as path:line: text, skipping ignored dirs", async () => {
    await seed("a.ts", "const x = 1;\nconst NEEDLE = 2;");
    await fsp.mkdir(join(root, "sub"), { recursive: true });
    await seed("sub/b.ts", "// NEEDLE here too");
    await fsp.mkdir(join(root, "node_modules"), { recursive: true });
    await seed("node_modules/c.ts", "NEEDLE should be ignored");
    const r = await call("search_files", { pattern: "NEEDLE" });
    expect(r).toMatch(/a\.ts:2: const NEEDLE = 2;/);
    expect(r).toMatch(/sub\/b\.ts:1:/);
    expect(r).not.toMatch(/node_modules/);
  });

  it("restricts to a glob and reports no matches cleanly", async () => {
    await seed("a.ts", "NEEDLE");
    await seed("a.md", "NEEDLE");
    const r = await call("search_files", {
      pattern: "NEEDLE",
      glob: "**/*.md",
    });
    expect(r).toMatch(/a\.md:1:/);
    expect(r).not.toMatch(/a\.ts/);
    expect(await call("search_files", { pattern: "ZZZ" })).toMatch(
      /No matches/,
    );
  });

  it("returns a clear error on an invalid regex", async () => {
    await seed("a.ts", "x");
    expect(await call("search_files", { pattern: "(" })).toMatch(
      /invalid regular expression/,
    );
  });

  it("caps output at 200 matches with a truncation marker", async () => {
    await seed(
      "big.txt",
      Array.from({ length: 250 }, () => "NEEDLE").join("\n"),
    );
    const r = await call("search_files", { pattern: "NEEDLE" });
    expect(r.split("\n").filter((l) => l.includes("NEEDLE")).length).toBe(200);
    expect(r).toMatch(/truncated at 200 matches/);
  });

  it("skips binary files (NUL byte)", async () => {
    await seed("bin", "NEEDLE" + String.fromCharCode(0) + "more");
    expect(await call("search_files", { pattern: "NEEDLE" })).toMatch(
      /No matches/,
    );
  });

  it("interprets the glob relative to the search base, consistently with glob()", async () => {
    await fsp.mkdir(join(root, "src"), { recursive: true });
    await seed("src/a.ts", "NEEDLE");
    // Same path+glob that the glob() tool would accept must also work here.
    const r = await call("search_files", {
      pattern: "NEEDLE",
      path: "src",
      glob: "*.ts",
    });
    expect(r).toMatch(/src\/a\.ts:1:/);
  });
});

describe("glob", () => {
  it("lists matching files sorted, root-relative", async () => {
    await seed("a.ts", "1");
    await fsp.mkdir(join(root, "src"), { recursive: true });
    await seed("src/b.ts", "2");
    await seed("src/c.js", "3");
    const r = await call("glob", { pattern: "**/*.ts" });
    expect(r.split("\n")).toEqual(["a.ts", "src/b.ts"]);
  });

  it("matches relative to a base path", async () => {
    await fsp.mkdir(join(root, "src"), { recursive: true });
    await seed("src/b.ts", "2");
    await seed("src/c.ts", "3");
    const r = await call("glob", { pattern: "*.ts", path: "src" });
    expect(r.split("\n").sort()).toEqual(["src/b.ts", "src/c.ts"]);
  });
});

describe("file ops", () => {
  it("make_dir / move_file / stat_path / delete_file round-trip", async () => {
    expect(await call("make_dir", { path: "d" })).toMatch(/Created d\//);
    await seed("d/x.txt", "hi");
    expect(await call("stat_path", { path: "d/x.txt" })).toMatch(
      /d\/x\.txt: file, 2 bytes/,
    );
    expect(await call("move_file", { from: "d/x.txt", to: "d/y.txt" })).toMatch(
      /Moved/,
    );
    expect(await read("d/y.txt")).toBe("hi");
    expect(await call("delete_file", { path: "d/y.txt" })).toMatch(/Deleted/);
    expect(await call("stat_path", { path: "d/y.txt" })).toMatch(
      /does not exist/,
    );
  });

  it("delete_file reports a clear error on a missing path", async () => {
    expect(await call("delete_file", { path: "ghost" })).toMatch(
      /does not exist/,
    );
  });

  it("file ops reject paths that escape the root", async () => {
    expect(await call("make_dir", { path: "../evil" })).toMatch(/Error:/);
    expect(await call("delete_file", { path: "../evil" })).toMatch(
      /Error:|does not exist/,
    );
    expect(await call("move_file", { from: "a", to: "../evil" })).toMatch(
      /Error:/,
    );
  });
});

describe("run_shell policy", () => {
  const callShell = async (command: string, policy?: CommandPolicy) => {
    const t = createShellTool({ cwd: root, policy });
    return (await t.implementation({ command }, ctx)) as string;
  };

  it("refuses a denied command without running it", async () => {
    const r = await callShell("rm -rf .", { deny: ["rm"] });
    expect(r).toMatch(/refused by policy/);
    // the directory still exists → nothing ran
    expect(await fsp.readdir(root)).toBeDefined();
  });

  it("runs a command permitted by the allow list", async () => {
    const r = await callShell("echo hello", { allow: ["echo"] });
    expect(r).toMatch(/exit: 0/);
    expect(r).toMatch(/hello/);
  });
});
