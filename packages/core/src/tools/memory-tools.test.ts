import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTools } from "./memory-tools";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createMemoryTools>[number]["implementation"]>
>[1];

let root = "";
async function call(
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const t = createMemoryTools({ root }).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return (await t.implementation(params, ctx)) as string;
}

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "memory-tools-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("createMemoryTools", () => {
  it("exposes remember / recall / forget", () => {
    expect(
      createMemoryTools({ root })
        .map((t) => t.name)
        .sort(),
    ).toEqual(["forget", "recall", "remember"]);
  });
});

describe("remember / recall / forget round-trip", () => {
  it("writes a frontmatter note into the knowledge dir and recalls it", async () => {
    const saved = await call("remember", {
      text: "The user prefers dark mode",
      tags: ["preference", "ui"],
    });
    expect(saved).toMatch(/Remembered as "the-user-prefers-dark-mode"/);

    // The note is a real markdown file under memories/ with frontmatter —
    // so the RAG preprocessor that indexes this dir will pick it up.
    const file = join(root, "memories", "the-user-prefers-dark-mode.md");
    const raw = await fsp.readFile(file, "utf8");
    expect(raw).toMatch(
      /^---\ntags: \[preference, ui\]\ncreated: \d{4}-\d{2}-\d{2}\n---/,
    );
    expect(raw).toMatch(/The user prefers dark mode/);

    const hit = await call("recall", { query: "dark mode" });
    expect(hit).toMatch(/\[the-user-prefers-dark-mode\].*\(preference, ui\)/);

    expect(await call("recall", { query: "nonexistent topic" })).toMatch(
      /No memories match/,
    );

    expect(await call("forget", { id: "the-user-prefers-dark-mode" })).toMatch(
      /Forgot/,
    );
    expect(await call("forget", { id: "the-user-prefers-dark-mode" })).toMatch(
      /No memory with id/,
    );
  });

  it("disambiguates colliding slugs and overwrites by explicit id", async () => {
    const a = await call("remember", { text: "Project status update" });
    const b = await call("remember", { text: "Project status update" });
    expect(a).toMatch(/"project-status-update"/);
    expect(b).toMatch(/"project-status-update-2"/);

    // Explicit id overwrites in place (no -2).
    const c = await call("remember", {
      text: "new body",
      id: "project-status-update",
    });
    expect(c).toMatch(/"project-status-update"/);
    expect(
      await fsp.readFile(
        join(root, "memories", "project-status-update.md"),
        "utf8",
      ),
    ).toMatch(/new body/);
  });

  it("rejects empty text and empty query", async () => {
    expect(await call("remember", { text: "   " })).toMatch(/Error:/);
    expect(await call("recall", { query: "  " })).toMatch(/Error:/);
  });

  it("forget cannot delete a file outside memories/ via a crafted id", async () => {
    // A real KB note sitting in the knowledge-dir root (what the RAG indexes).
    await fsp.writeFile(join(root, "important.md"), "do not delete");
    // A traversal id is slugified to a harmless slug → no match, no deletion.
    const r = await call("forget", { id: "../important" });
    expect(r).toMatch(/No memory with id/);
    expect(await fsp.readFile(join(root, "important.md"), "utf8")).toBe(
      "do not delete",
    );
  });
});
