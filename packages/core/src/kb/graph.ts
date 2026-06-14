/**
 * KbGraph holds the parsed nodes plus the indexes the map tools need: lookup by
 * path and by name, and `[[wikilink]]` traversal (outgoing + incoming). It is
 * built from a plain KbNode[] so it round-trips cleanly through a JSON cache —
 * persist `graph.nodes`, then `new KbGraph(nodes)` to rebuild the indexes.
 */
import type { KbNode } from "./node";

export interface LinkResolution {
  /** Linked nodes that resolved to a real entry, by name. */
  resolved: KbNode[];
  /** `[[names]]` with no matching node yet (TODO markers, not errors). */
  dangling: string[];
}

export class KbGraph {
  readonly nodes: KbNode[];
  private readonly byPath: Map<string, KbNode>;
  private readonly byName: Map<string, KbNode>;

  constructor(nodes: KbNode[]) {
    this.nodes = nodes;
    this.byPath = new Map();
    this.byName = new Map();
    for (const node of nodes) {
      this.byPath.set(node.path, node);
      // First writer wins, so a name collision is deterministic by scan order.
      if (!this.byName.has(node.name)) this.byName.set(node.name, node);
    }
  }

  get size(): number {
    return this.nodes.length;
  }

  get(path: string): KbNode | undefined {
    return this.byPath.get(path);
  }

  getByName(name: string): KbNode | undefined {
    return this.byName.get(name);
  }

  /** Forward links of a node, split into resolved nodes and dangling names. */
  outgoing(node: KbNode): LinkResolution {
    const resolved: KbNode[] = [];
    const dangling: string[] = [];
    for (const name of node.links) {
      const target = this.byName.get(name);
      if (target) resolved.push(target);
      else dangling.push(name);
    }
    return { resolved, dangling };
  }

  /** Nodes whose body links to `node` (by its name). */
  incoming(node: KbNode): KbNode[] {
    const out: KbNode[] = [];
    for (const candidate of this.nodes) {
      if (candidate.path === node.path) continue;
      if (candidate.links.includes(node.name)) out.push(candidate);
    }
    return out;
  }
}
