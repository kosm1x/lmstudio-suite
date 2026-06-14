import { describe, it, expect } from "vitest";
import { KbGraph } from "./graph";
import { searchNodes } from "./search";
import type { KbNode } from "./node";

function node(p: Partial<KbNode> & { path: string; name: string }): KbNode {
  return {
    description: "",
    tier: "index",
    tags: [],
    links: [],
    dir: ".",
    mtimeMs: 0,
    size: 0,
    ...p,
  };
}

const graph = new KbGraph([
  node({
    path: "a.md",
    name: "whatsapp-ban",
    description: "fingerprint sweep",
    tags: ["wa"],
  }),
  node({ path: "b.md", name: "git-rules", description: "use https not ssh" }),
  node({
    path: "archive/c.md",
    name: "old-ban-note",
    description: "legacy whatsapp",
    tier: "warm",
  }),
]);

describe("searchNodes", () => {
  it("ranks name hits above description hits", () => {
    const hits = searchNodes(graph, "ban");
    expect(hits[0]?.node.name).toBe("whatsapp-ban");
  });

  it("searches the warm tier too", () => {
    const hits = searchNodes(graph, "whatsapp");
    expect(hits.map((h) => h.node.path)).toContain("archive/c.md");
  });

  it("requires every token to match (AND semantics)", () => {
    // No node mentions both "whatsapp" and "git".
    expect(searchNodes(graph, "whatsapp git")).toHaveLength(0);
    // Both these match every token; whatsapp-ban scores higher (name hits).
    expect(searchNodes(graph, "whatsapp ban").map((h) => h.node.name)).toEqual([
      "whatsapp-ban",
      "old-ban-note",
    ]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchNodes(graph, "   ")).toEqual([]);
  });

  it("honors the limit", () => {
    expect(searchNodes(graph, "ban", 1)).toHaveLength(1);
  });
});
