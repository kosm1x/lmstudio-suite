import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapTools } from "./map-tools";
import { scanKbDir, type KbGraph } from "../kb/index";

let root = "";
let graph: KbGraph;

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createMapTools>[number]["implementation"]>
>[1];

/** Invoke a named tool's implementation with parsed params. */
async function call(
  tools: ReturnType<typeof createMapTools>,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return (await t.implementation(params, ctx)) as string;
}

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "map-tools-"));
  await fsp.mkdir(join(root, "lessons"), { recursive: true });
  await fsp.writeFile(
    join(root, "lessons", "alpha.md"),
    "---\nname: alpha\ndescription: the alpha note\n---\nsee [[beta]] and [[ghost]]",
  );
  await fsp.writeFile(
    join(root, "lessons", "beta.md"),
    "---\nname: beta\ndescription: the beta note\n---\nbody",
  );
  // A non-indexed secret in the root: omitted from the map, must stay unreadable.
  await fsp.writeFile(join(root, "secret.env"), "API_KEY=sk-should-not-leak");
  graph = (await scanKbDir(root)).graph;
});

afterAll(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

const make = (enableWrite = false) =>
  createMapTools({ root, loadGraph: async () => graph, enableWrite });

describe("createMapTools", () => {
  it("exposes the read-only toolset by default, no write_node", () => {
    expect(
      make()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["follow_links", "map_overview", "read_node", "search_map"]);
  });

  it("adds write_node only when enabled", () => {
    expect(make(true).map((t) => t.name)).toContain("write_node");
  });

  it("map_overview renders the digest and a single folder", async () => {
    const tools = make();
    expect(await call(tools, "map_overview", {})).toContain("## KB MAP");
    const folder = await call(tools, "map_overview", { folder: "lessons" });
    expect(folder).toContain("- [alpha] lessons/alpha.md");
  });

  it("search_map finds by keyword", async () => {
    const out = await call(make(), "search_map", { query: "beta", limit: 12 });
    expect(out).toContain("lessons/beta.md");
  });

  it("read_node returns indexed content but refuses traversal and non-indexed files", async () => {
    const tools = make();
    expect(
      await call(tools, "read_node", { path: "lessons/beta.md" }),
    ).toContain("the beta note");
    expect(
      await call(tools, "read_node", { path: "../../etc/passwd" }),
    ).toMatch(/not an indexed entry|Error:/);
    // The secret exists on disk inside the root but is not in the map → unreadable.
    const out = await call(tools, "read_node", { path: "secret.env" });
    expect(out).toContain("not an indexed entry");
    expect(out).not.toContain("sk-should-not-leak");
  });

  it("follow_links reports resolved, dangling, and backlinks", async () => {
    const out = await call(make(), "follow_links", {
      path: "lessons/alpha.md",
    });
    expect(out).toContain("Links to:");
    expect(out).toContain("beta");
    expect(out).toContain("Dangling links (no entry yet): ghost");
    // beta is linked-from alpha
    const backOut = await call(make(), "follow_links", {
      path: "lessons/beta.md",
    });
    expect(backOut).toContain("Linked from:");
    expect(backOut).toContain("alpha");
  });

  it("write_node writes text notes within the root", async () => {
    const out = await call(make(true), "write_node", {
      path: "notes/new.md",
      content: "# fresh",
    });
    expect(out).toMatch(/Wrote \d+ characters/);
    expect(await fsp.readFile(join(root, "notes", "new.md"), "utf-8")).toBe(
      "# fresh",
    );
  });

  it("write_node refuses non-text extensions", async () => {
    const out = await call(make(true), "write_node", {
      path: "evil.sh",
      content: "rm -rf /",
    });
    expect(out).toMatch(/only writes text notes/);
    await expect(fsp.access(join(root, "evil.sh"))).rejects.toThrow();
  });
});
