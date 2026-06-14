import { describe, it, expect } from "vitest";
import { KbGraph } from "./graph";
import type { KbNode } from "./node";

function node(
  partial: Partial<KbNode> & { path: string; name: string },
): KbNode {
  return {
    description: "",
    tier: "index",
    tags: [],
    links: [],
    dir: ".",
    mtimeMs: 0,
    size: 0,
    ...partial,
  };
}

describe("KbGraph", () => {
  const a = node({ path: "a.md", name: "alpha", links: ["beta", "ghost"] });
  const b = node({ path: "b.md", name: "beta", links: ["alpha"] });
  const c = node({ path: "c.md", name: "gamma", links: ["beta"] });
  const graph = new KbGraph([a, b, c]);

  it("looks up by path and name", () => {
    expect(graph.get("b.md")?.name).toBe("beta");
    expect(graph.getByName("gamma")?.path).toBe("c.md");
    expect(graph.get("missing.md")).toBeUndefined();
  });

  it("resolves outgoing links and reports dangling ones", () => {
    const out = graph.outgoing(a);
    expect(out.resolved.map((n) => n.name)).toEqual(["beta"]);
    expect(out.dangling).toEqual(["ghost"]);
  });

  it("finds incoming links (backlinks)", () => {
    const into = graph.incoming(b);
    expect(into.map((n) => n.name).sort()).toEqual(["alpha", "gamma"]);
  });

  it("excludes self from backlinks", () => {
    const self = node({ path: "s.md", name: "self", links: ["self"] });
    const g = new KbGraph([self]);
    expect(g.incoming(self)).toEqual([]);
  });
});
