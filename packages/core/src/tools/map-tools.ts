/**
 * SDK `tool()` builders for "map memory" — structural navigation over a
 * knowledge-base directory, shared by the kb-map plugin and the agent CLI.
 *
 * The model gets a small, deterministic toolkit that mirrors how a human reads
 * an index: see the map, search it (incl. archived/warm entries), read one
 * entry in full, and walk its `[[wikilink]]` graph. Writing is opt-in. All file
 * access is scoped to `root` via ScopedFs; the graph is supplied by `loadGraph`
 * so the caller controls caching (the plugin caches; the CLI memoises).
 */
import { extname } from "node:path";
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs } from "../fs/index";
import {
  planIncomingMoves,
  renderDigest,
  renderFolder,
  renderNodeLine,
  searchNodes,
  type KbGraph,
} from "../kb/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** write_node may only create the text file types the map indexes. */
const WRITABLE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

export interface MapToolsOptions {
  /** Knowledge-base root; all reads/writes are scoped here. */
  root: string;
  /** Supplies the current graph (cache-/memo-backed by the caller). */
  loadGraph: () => Promise<KbGraph>;
  /** Expose write_node + organize_incoming (create/move entries). Off by default. */
  enableWrite?: boolean;
  /** Char budget for the injected/overview map (default 4000). */
  digestMaxChars?: number;
  /** Inbox folder new captures land in and organize_incoming sorts (default "incoming"). */
  incomingFolder?: string;
}

export function createMapTools(options: MapToolsOptions): Tool[] {
  const { root, loadGraph } = options;
  const fs = new ScopedFs(root);
  const digestMaxChars = options.digestMaxChars ?? 4_000;
  const incomingFolder = options.incomingFolder ?? "incoming";

  const tools: Tool[] = [
    tool({
      name: "map_overview",
      description:
        "Show the knowledge-base map: a compact index of entries (name, path, " +
        "one-line description, links), grouped by folder. Call with no argument " +
        "for the whole map, or pass a folder name to list just that folder in " +
        "full. Start here to see what exists before reading anything.",
      parameters: {
        folder: z
          .string()
          .optional()
          .describe("Optional folder name to expand in full (e.g. 'lessons')."),
      },
      implementation: async ({ folder }, { status }) => {
        status(folder ? `Map of ${folder}/` : "Map overview");
        const graph = await loadGraph();
        if (graph.size === 0) return "(the knowledge base is empty)";
        return folder
          ? renderFolder(graph, folder)
          : renderDigest(graph, { root, maxChars: digestMaxChars });
      },
    }),
    tool({
      name: "search_map",
      description:
        "Search the map by keyword across entry names, paths, descriptions and " +
        "tags. Unlike the always-on map this also searches archived/warm " +
        "entries. Returns matching entries with their paths (read one with " +
        "read_node). Use multiple words to narrow — every word must match.",
      parameters: {
        query: z.string().describe("Keywords to search for."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(12)
          .describe("Max results (default 12)."),
      },
      implementation: async ({ query, limit }, { status }) => {
        status(`Searching: ${query}`);
        const graph = await loadGraph();
        const hits = searchNodes(graph, query, limit);
        if (hits.length === 0) return `No entries match "${query}".`;
        return hits.map((h) => renderNodeLine(h.node, 3)).join("\n");
      },
    }),
    tool({
      name: "read_node",
      description:
        "Read the full contents of one entry by its path (the path shown in the " +
        "map). Use after map_overview/search_map to pull the detail behind a " +
        "one-line description.",
      parameters: {
        path: z.string().describe("Entry path relative to the KB root."),
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Reading ${path}`);
        // Only entries that appear in the map are readable. This keeps a model
        // from reaching non-indexed files in the KB root (a `.env`, a private
        // key, a dotfile) that collectKbFiles deliberately omits from the map.
        const graph = await loadGraph();
        if (!graph.get(path)) {
          return `Error: "${path}" is not an indexed entry. Use map_overview or search_map to find entries.`;
        }
        try {
          return await fs.readFile(path);
        } catch (err) {
          const m = msg(err);
          warn(`read_node failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
    tool({
      name: "follow_links",
      description:
        "Given an entry's path, list the entries it links to (via [[name]]) and " +
        "the entries that link back to it. Use to traverse related notes — the " +
        "associative graph the flat map does not show. Dangling links (no entry " +
        "yet) are reported separately.",
      parameters: {
        path: z.string().describe("Entry path to traverse from."),
      },
      implementation: async ({ path }, { status }) => {
        status(`Links of ${path}`);
        const graph = await loadGraph();
        const node = graph.get(path);
        if (!node)
          return `Error: no entry at "${path}". Use map_overview or search_map.`;
        const out = graph.outgoing(node);
        const incoming = graph.incoming(node);
        const sections: string[] = [];
        sections.push(
          out.resolved.length
            ? "Links to:\n" +
                out.resolved.map((n) => renderNodeLine(n, 0)).join("\n")
            : "Links to: (none)",
        );
        if (out.dangling.length)
          sections.push(
            `Dangling links (no entry yet): ${out.dangling.join(", ")}`,
          );
        sections.push(
          incoming.length
            ? "Linked from:\n" +
                incoming.map((n) => renderNodeLine(n, 0)).join("\n")
            : "Linked from: (none)",
        );
        return sections.join("\n\n");
      },
    }),
  ];

  if (options.enableWrite) {
    tools.push(
      tool({
        name: "write_node",
        description:
          "Save a note into the knowledge base. For a NEW capture, write it to " +
          `\`${incomingFolder}/<kebab-name>.md\` (the inbox; organize_incoming sorts it later). ` +
          "ALWAYS begin the file with YAML frontmatter and fill every field:\n" +
          "---\n" +
          "name: <kebab-slug matching the filename>\n" +
          "description: <one concise sentence summarising the note>\n" +
          "metadata:\n" +
          "  type: <project | area | note | reference>\n" +
          "tags: [<2-5 lowercase topic tags>]\n" +
          "---\n" +
          "Then a `# Title` and the body. Good name/description/type/tags are what " +
          "let the note be sorted and found later, so do not leave them blank. The " +
          "map refreshes automatically on the next turn.",
        parameters: {
          path: z
            .string()
            .describe(
              `Destination path relative to the KB root, ending in .md (e.g. '${incomingFolder}/my-note.md').`,
            ),
          content: z
            .string()
            .describe(
              "Full file contents, starting with the YAML frontmatter block.",
            ),
        },
        implementation: async ({ path, content }, { status, warn }) => {
          status(`Writing ${path}`);
          if (!WRITABLE_EXTENSIONS.has(extname(path).toLowerCase())) {
            return `Error: write_node only writes text notes (${[...WRITABLE_EXTENSIONS].join(", ")}); refusing "${path}".`;
          }
          try {
            const wrote = await fs.writeFileIfChanged(path, content);
            return wrote
              ? `Wrote ${content.length} characters to ${path}.`
              : `No change: ${path} already contains exactly this content. The note is already saved (the map refreshes next turn) — do not write it again.`;
          } catch (err) {
            const m = msg(err);
            warn(`write_node failed: ${m}`);
            return `Error: ${m}`;
          }
        },
      }),
      tool({
        name: "organize_incoming",
        description:
          `Sort the \`${incomingFolder}/\` inbox into the knowledge base's folders using each ` +
          "note's frontmatter type and tags (type: project → projects/, a 'reference' tag → " +
          "references/, etc.). Call with apply=false (default) to PREVIEW the moves, then " +
          "apply=true to perform them. Notes with no usable type/tag are left in the inbox.",
        parameters: {
          apply: z
            .boolean()
            .default(false)
            .describe("false = preview the plan; true = perform the moves."),
        },
        implementation: async ({ apply }, { status, warn }) => {
          status(
            apply
              ? `Organizing ${incomingFolder}/`
              : `Previewing ${incomingFolder}/ sort`,
          );
          const graph = await loadGraph();
          const plan = planIncomingMoves(graph, { incomingFolder });

          // Reconcile the index-based plan with the disk: the planner only sees
          // indexed text files, so a target that exists on disk but isn't indexed
          // (a dotfile, or a file past the scan cap) would slip its conflict
          // check. Re-check every target with fs.exists so the PREVIEW matches
          // what apply will actually do — no preview/apply divergence.
          const movable: typeof plan.moves = [];
          for (const m of plan.moves) {
            if (await fs.exists(m.to)) {
              plan.conflicts.push({
                from: m.from,
                to: m.to,
                reason: "target already exists",
              });
            } else {
              movable.push(m);
            }
          }

          if (movable.length === 0 && plan.conflicts.length === 0) {
            return plan.unsorted.length > 0
              ? `Nothing to sort: ${plan.unsorted.length} note(s) in ${incomingFolder}/ have no type/tag to route on.`
              : `${incomingFolder}/ is empty — nothing to organize.`;
          }

          const lines: string[] = [];
          if (!apply) {
            lines.push(
              `Planned moves (re-run organize_incoming with apply=true to perform):`,
            );
            for (const m of movable)
              lines.push(`  ${m.from} → ${m.to}   (${m.reason})`);
          } else {
            let moved = 0;
            for (const m of movable) {
              try {
                // Single-user, local-fs tool: we accept the tiny TOCTOU between
                // the fs.exists check above and the rename. fs.move refuses to
                // escape the root; a concurrent writer is out of scope here.
                await fs.move(m.from, m.to);
                moved++;
              } catch (err) {
                const e = msg(err);
                warn(`move failed: ${e}`);
                plan.conflicts.push({ from: m.from, to: m.to, reason: e });
              }
            }
            lines.push(`Moved ${moved} note(s).`);
          }

          if (plan.conflicts.length > 0) {
            lines.push(`Skipped (conflicts):`);
            for (const c of plan.conflicts)
              lines.push(`  ${c.from} → ${c.to}   (${c.reason})`);
          }
          if (plan.unsorted.length > 0) {
            lines.push(
              `Left in ${incomingFolder}/ (no type/tag): ${plan.unsorted.map((u) => u.path).join(", ")}`,
            );
          }
          return lines.join("\n");
        },
      }),
    );
  }

  return tools;
}
