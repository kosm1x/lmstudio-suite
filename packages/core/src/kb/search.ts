/**
 * Deterministic keyword search over the map — the cheap, no-embeddings half of
 * retrieval. Scores each node by where the query tokens hit (name > tags > path
 * > description), and unlike the always-on digest it searches the warm tier too,
 * so archived entries are reachable. A node matches only if it hits EVERY token
 * (AND semantics), which keeps multi-word queries precise.
 */
import type { KbGraph } from "./graph";
import type { KbNode } from "./node";

export interface SearchHit {
  node: KbNode;
  score: number;
}

const WEIGHT_NAME = 3;
const WEIGHT_TAG = 2;
const WEIGHT_PATH = 2;
const WEIGHT_DESC = 1;

function scoreToken(node: KbNode, token: string): number {
  let score = 0;
  if (node.name.toLowerCase().includes(token)) score += WEIGHT_NAME;
  if (node.tags.some((t) => t.toLowerCase().includes(token)))
    score += WEIGHT_TAG;
  if (node.path.toLowerCase().includes(token)) score += WEIGHT_PATH;
  if (node.description.toLowerCase().includes(token)) score += WEIGHT_DESC;
  return score;
}

export function searchNodes(
  graph: KbGraph,
  query: string,
  limit = 12,
): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const node of graph.nodes) {
    let total = 0;
    let missedToken = false;
    for (const token of tokens) {
      const s = scoreToken(node, token);
      if (s === 0) {
        missedToken = true;
        break;
      }
      total += s;
    }
    if (!missedToken && total > 0) hits.push({ node, score: total });
  }

  hits.sort((a, b) =>
    b.score === a.score
      ? a.node.path.localeCompare(b.node.path)
      : b.score - a.score,
  );
  return hits.slice(0, limit);
}
