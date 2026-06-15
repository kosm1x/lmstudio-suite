import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsTools } from "./local-tools";

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
