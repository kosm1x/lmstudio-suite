/**
 * Plan how to sort the `incoming/` inbox into the knowledge base's folders,
 * using each note's frontmatter `type` and `tags`. Pure and deterministic so the
 * organize_incoming tool can show a dry-run plan before moving anything, and a
 * note with no usable type/tag is left where it is rather than mis-filed.
 *
 * Routing precedence for one incoming note:
 *   1. `type` → its folder (project→projects, area→areas, note→notes, …)
 *   2. else the first `tag` that names a known type or folder
 *   3. else: unsorted (stays in incoming/), unless a defaultFolder is configured.
 */
import type { KbGraph } from "./graph";
import type { KbNode } from "./node";

export interface IncomingMove {
  from: string;
  to: string;
  reason: string;
}

export interface IncomingPlan {
  moves: IncomingMove[];
  conflicts: Array<{ from: string; to: string; reason: string }>;
  unsorted: Array<{ path: string; reason: string }>;
}

export interface OrganizeOptions {
  /** Inbox folder to sort (default "incoming"). */
  incomingFolder?: string;
  /** Where un-routable notes go; omit to leave them in the inbox. */
  defaultFolder?: string;
  /** type → destination folder mapping. */
  typeFolders?: Record<string, string>;
}

const DEFAULT_TYPE_FOLDERS: Record<string, string> = {
  project: "projects",
  area: "areas",
  reference: "references",
  note: "notes",
  daily: "daily",
};

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Resolve a destination folder for one node from its type, then its tags. */
function destFolderFor(
  node: KbNode,
  typeFolders: Record<string, string>,
  knownFolders: Set<string>,
): { folder: string; reason: string } | null {
  const type = node.type?.toLowerCase();
  if (type && typeFolders[type]) {
    return { folder: typeFolders[type], reason: `type=${type}` };
  }
  for (const tag of node.tags) {
    const t = tag.toLowerCase();
    if (typeFolders[t]) return { folder: typeFolders[t], reason: `tag=${tag}` };
    if (knownFolders.has(t)) return { folder: t, reason: `tag=${tag}` };
  }
  return null;
}

export function planIncomingMoves(
  graph: KbGraph,
  options: OrganizeOptions = {},
): IncomingPlan {
  const incoming = options.incomingFolder ?? "incoming";
  const typeFolders = options.typeFolders ?? DEFAULT_TYPE_FOLDERS;
  const knownFolders = new Set(Object.values(typeFolders));

  const moves: IncomingMove[] = [];
  const conflicts: IncomingPlan["conflicts"] = [];
  const unsorted: IncomingPlan["unsorted"] = [];

  for (const node of graph.nodes) {
    if (node.dir !== incoming) continue;

    const dest = destFolderFor(node, typeFolders, knownFolders);
    const folder = dest?.folder ?? options.defaultFolder;
    if (!folder || folder === incoming) {
      unsorted.push({ path: node.path, reason: "no type/tag match" });
      continue;
    }

    const to = `${folder}/${basename(node.path)}`;
    if (graph.get(to)) {
      conflicts.push({ from: node.path, to, reason: "target already exists" });
      continue;
    }
    moves.push({ from: node.path, to, reason: dest?.reason ?? "default" });
  }

  return { moves, conflicts, unsorted };
}
