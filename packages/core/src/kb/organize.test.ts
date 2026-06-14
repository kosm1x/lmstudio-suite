import { describe, it, expect } from "vitest";
import { KbGraph } from "./graph";
import { planIncomingMoves } from "./organize";
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

describe("planIncomingMoves", () => {
  it("routes by frontmatter type", () => {
    const g = new KbGraph([
      node({ path: "incoming/a.md", name: "a", type: "project" }),
      node({ path: "incoming/b.md", name: "b", type: "reference" }),
    ]);
    const plan = planIncomingMoves(g);
    expect(plan.moves).toEqual([
      { from: "incoming/a.md", to: "projects/a.md", reason: "type=project" },
      {
        from: "incoming/b.md",
        to: "references/b.md",
        reason: "type=reference",
      },
    ]);
  });

  it("falls back to tags when type is absent", () => {
    const g = new KbGraph([
      node({ path: "incoming/c.md", name: "c", tags: ["misc", "reference"] }),
    ]);
    const plan = planIncomingMoves(g);
    expect(plan.moves[0]).toEqual({
      from: "incoming/c.md",
      to: "references/c.md",
      reason: "tag=reference",
    });
  });

  it("leaves notes with no type/tag match unsorted", () => {
    const g = new KbGraph([
      node({ path: "incoming/d.md", name: "d", tags: ["random"] }),
    ]);
    const plan = planIncomingMoves(g);
    expect(plan.moves).toEqual([]);
    expect(plan.unsorted.map((u) => u.path)).toEqual(["incoming/d.md"]);
  });

  it("uses a defaultFolder for un-routable notes when configured", () => {
    const g = new KbGraph([node({ path: "incoming/d.md", name: "d" })]);
    const plan = planIncomingMoves(g, { defaultFolder: "notes" });
    expect(plan.moves[0]?.to).toBe("notes/d.md");
  });

  it("reports a conflict instead of overwriting an existing target", () => {
    const g = new KbGraph([
      node({ path: "incoming/x.md", name: "x", type: "note" }),
      node({ path: "notes/x.md", name: "x-existing", type: "note" }),
    ]);
    const plan = planIncomingMoves(g);
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts[0]).toEqual({
      from: "incoming/x.md",
      to: "notes/x.md",
      reason: "target already exists",
    });
  });

  it("ignores files outside the incoming folder", () => {
    const g = new KbGraph([
      node({ path: "notes/keep.md", name: "keep", type: "project" }),
    ]);
    const plan = planIncomingMoves(g);
    expect(plan.moves).toEqual([]);
    expect(plan.unsorted).toEqual([]);
  });

  it("honors a custom incoming folder name", () => {
    const g = new KbGraph([
      node({ path: "inbox/y.md", name: "y", type: "area" }),
    ]);
    const plan = planIncomingMoves(g, { incomingFolder: "inbox" });
    expect(plan.moves[0]?.to).toBe("areas/y.md");
  });
});
