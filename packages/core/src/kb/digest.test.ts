import { describe, it, expect } from "vitest";
import { KbGraph } from "./graph";
import { renderDigest, renderFolder, renderNodeLine } from "./digest";
import type { KbNode } from "./node";

function node(p: Partial<KbNode> & { path: string; name: string }): KbNode {
  return {
    description: "",
    tier: "index",
    tags: [],
    links: [],
    dir: p.path.includes("/") ? p.path.slice(0, p.path.indexOf("/")) : ".",
    mtimeMs: 0,
    size: 0,
    ...p,
  };
}

describe("renderNodeLine", () => {
  it("formats name, path, description and links", () => {
    const line = renderNodeLine(
      node({
        path: "l/a.md",
        name: "alpha",
        description: "the desc",
        links: ["x", "y"],
      }),
      3,
    );
    expect(line).toBe("- [alpha] l/a.md — the desc  → x, y");
  });
  it("caps the number of links shown", () => {
    const line = renderNodeLine(
      node({ path: "a.md", name: "a", links: ["1", "2", "3", "4"] }),
      2,
    );
    expect(line).toContain("→ 1, 2, …");
  });
});

describe("renderDigest", () => {
  const graph = new KbGraph([
    node({ path: "lessons/a.md", name: "alpha", description: "first" }),
    node({ path: "lessons/b.md", name: "beta", description: "second" }),
    node({
      path: "archive/old.md",
      name: "old",
      description: "x",
      tier: "warm",
    }),
  ]);

  it("groups index entries by folder and summarises the warm tier", () => {
    const out = renderDigest(graph, { root: "/kb" });
    expect(out).toContain("## KB MAP (root: /kb) · 3 entries · 1 warm");
    expect(out).toContain("### lessons/");
    expect(out).toContain("- [alpha] lessons/a.md — first");
    // warm entry is summarised, not listed inline
    expect(out).toContain("### archive/  (warm · 1 entries — not expanded");
    expect(out).not.toContain("- [old]");
  });

  it("collapses overflow into a +N more rollup under the char budget", () => {
    const big = new KbGraph(
      Array.from({ length: 20 }, (_, i) =>
        node({
          path: `lessons/n${i}.md`,
          name: `node-${i}`,
          description: "x".repeat(80),
        }),
      ),
    );
    const out = renderDigest(big, { maxChars: 300 });
    expect(out).toMatch(/\+\d+ more/);
    expect(out.length).toBeLessThan(600); // budget kept the map small
  });

  it("stays bounded even with many single-file folders (W1 regression)", () => {
    // The pathological layout: one folder per entry, so the per-node rollup
    // never triggers — the budget must be enforced at the folder level too.
    const many = new KbGraph(
      Array.from({ length: 200 }, (_, i) =>
        node({
          path: `topic${i}/note.md`,
          name: `note-${i}`,
          description: "y".repeat(60),
        }),
      ),
    );
    const maxChars = 1000;
    const out = renderDigest(many, { maxChars });
    expect(out.length).toBeLessThanOrEqual(maxChars);
    expect(out).toMatch(/more entries across \d+ folders/);
  });

  it("bounds the warm tier too", () => {
    const warmMany = new KbGraph(
      Array.from({ length: 300 }, (_, i) =>
        node({ path: `archive${i}/n.md`, name: `w-${i}`, tier: "warm" }),
      ),
    );
    const maxChars = 600;
    const out = renderDigest(warmMany, { maxChars });
    expect(out.length).toBeLessThanOrEqual(maxChars);
  });
});

describe("renderFolder", () => {
  const graph = new KbGraph([
    node({ path: "lessons/a.md", name: "alpha" }),
    node({ path: "lessons/b.md", name: "beta" }),
    node({ path: "other/c.md", name: "gamma" }),
  ]);
  it("lists all entries of one folder", () => {
    const out = renderFolder(graph, "lessons");
    expect(out).toContain("lessons/ · 2 entries");
    expect(out).toContain("- [alpha]");
    expect(out).toContain("- [beta]");
    expect(out).not.toContain("gamma");
  });
  it("reports an empty folder clearly", () => {
    expect(renderFolder(graph, "nope")).toContain(
      'No entries in folder "nope"',
    );
  });
});
