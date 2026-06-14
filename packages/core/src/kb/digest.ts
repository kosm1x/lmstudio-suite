/**
 * Render a KbGraph into the compact "map" the model sees: a grouped, budgeted
 * index of one line per entry — the structural analogue of the project's own
 * MEMORY.md. Index-tier entries are listed inline; warm-tier folders are
 * summarised as a single grep-me line.
 *
 * `maxChars` is a HARD bound: every line (header excepted) is checked before it
 * is appended, dir headings and the warm section are counted, and once the
 * budget is reached the remainder collapses to a "+N more — use search_map"
 * rollup rather than being truncated mid-line or silently overflowing. This
 * matters because the digest is injected into context every turn.
 */
import type { KbGraph } from "./graph";
import type { KbNode } from "./node";

export interface DigestOptions {
  /** Hard cap on the rendered map size (default 4000). */
  maxChars?: number;
  /** Shown in the header for orientation. */
  root?: string;
  /** Max link names appended per entry (default 3). */
  maxLinksPerNode?: number;
}

const DEFAULT_MAX_CHARS = 4_000;
const MAX_DESC_CHARS = 110;

function clampDesc(desc: string): string {
  const oneLine = desc.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DESC_CHARS
    ? oneLine.slice(0, MAX_DESC_CHARS - 1) + "…"
    : oneLine;
}

/** One map line for a node: `- [name] path — desc  → a, b`. */
export function renderNodeLine(node: KbNode, maxLinks: number): string {
  let line = `- [${node.name}] ${node.path}`;
  const desc = clampDesc(node.description);
  if (desc) line += ` — ${desc}`;
  if (node.links.length > 0) {
    const shown = node.links.slice(0, maxLinks).join(", ");
    const extra = node.links.length > maxLinks ? ", …" : "";
    line += `  → ${shown}${extra}`;
  }
  return line;
}

function dirLabel(dir: string): string {
  return dir === "." ? "(root)" : dir + "/";
}

/** Group nodes by their top-level folder, preserving a stable folder order. */
function groupByDir(nodes: KbNode[]): Array<[string, KbNode[]]> {
  const groups = new Map<string, KbNode[]>();
  const sorted = [...nodes].sort((a, b) =>
    a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir),
  );
  for (const node of sorted) {
    const list = groups.get(node.dir);
    if (list) list.push(node);
    else groups.set(node.dir, [node]);
  }
  return [...groups];
}

export function renderDigest(
  graph: KbGraph,
  options: DigestOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLinks = options.maxLinksPerNode ?? 3;

  const index = graph.nodes.filter((n) => n.tier === "index");
  const warm = graph.nodes.filter((n) => n.tier === "warm");

  const header =
    `## KB MAP${options.root ? ` (root: ${options.root})` : ""} · ` +
    `${graph.size} entries` +
    (warm.length ? ` · ${warm.length} warm` : "");

  // Reserve headroom so a trailing "+N more" summary always fits: content is
  // packed up to `softMax`, summaries may use the remaining budget up to maxChars.
  const RESERVE = 100;
  const softMax = maxChars > RESERVE ? maxChars - RESERVE : maxChars;
  const out: string[] = [];
  let used = 0;
  const push = (line: string): void => {
    out.push(line);
    used += line.length + 1;
  };
  const fits = (line: string): boolean => used + line.length + 1 <= softMax;
  const fitsSummary = (line: string): boolean =>
    used + line.length + 1 <= maxChars;

  // The header + blank are always emitted (they are the map's identity).
  push(header);
  push("");

  const groups = groupByDir(index);
  let truncated = false;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (!group) continue;
    const [dir, nodes] = group;
    const heading = `### ${dirLabel(dir)}`;
    const firstLine = nodes[0] ? renderNodeLine(nodes[0], maxLinks) : "";

    // If we can't fit this folder's heading AND its first entry, stop here and
    // summarise everything still unshown so the map stays bounded.
    if (used + heading.length + 1 + firstLine.length + 1 > softMax) {
      const remEntries = groups
        .slice(gi)
        .reduce((sum, [, ns]) => sum + ns.length, 0);
      const remFolders = groups.length - gi;
      const summary = `… +${remEntries} more entries across ${remFolders} folders — use search_map / map_overview`;
      if (fitsSummary(summary)) push(summary);
      truncated = true;
      break;
    }

    push(heading);
    let shown = 0;
    for (const node of nodes) {
      const line = renderNodeLine(node, maxLinks);
      if (!fits(line)) {
        const rollup = `  (+${nodes.length - shown} more in ${dir} — use search_map)`;
        if (fits(rollup)) push(rollup);
        break;
      }
      push(line);
      shown++;
    }
  }

  // Warm tier: never expanded inline — one grep-me line per folder, budgeted.
  // Skipped entirely if the index tier already exhausted the budget.
  if (!truncated && warm.length > 0) {
    const warmGroups = groupByDir(warm);
    let openedSection = false;
    for (let wi = 0; wi < warmGroups.length; wi++) {
      const group = warmGroups[wi];
      if (!group) continue;
      const [dir, nodes] = group;
      const line = `### ${dirLabel(dir)}  (warm · ${nodes.length} entries — not expanded; use search_map)`;
      const blankCost = openedSection ? 0 : 2;
      if (used + blankCost + line.length + 1 > softMax) {
        const remFolders = warmGroups.length - wi;
        const summary = `… +${remFolders} more warm folders — use search_map`;
        if (fitsSummary(summary)) push(summary);
        break;
      }
      if (!openedSection) {
        push("");
        openedSection = true;
      }
      push(line);
    }
  }

  return out.join("\n");
}

/** Full listing of a single folder (used by `map_overview(folder)`). */
export function renderFolder(
  graph: KbGraph,
  folder: string,
  maxLinks = 3,
): string {
  const wanted = folder === "(root)" ? "." : folder.replace(/\/$/, "");
  const nodes = graph.nodes
    .filter((n) => n.dir === wanted)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (nodes.length === 0) {
    return `No entries in folder "${folder}". Use map_overview to see folders.`;
  }
  const heading = `### ${wanted === "." ? "(root)" : wanted + "/"} · ${nodes.length} entries`;
  return [heading, ...nodes.map((n) => renderNodeLine(n, maxLinks))].join("\n");
}
