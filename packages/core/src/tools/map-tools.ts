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
  /** Expose write_node (create/update entries). Off by default. */
  enableWrite?: boolean;
  /** Char budget for the injected/overview map (default 4000). */
  digestMaxChars?: number;
}

export function createMapTools(options: MapToolsOptions): Tool[] {
  const { root, loadGraph } = options;
  const fs = new ScopedFs(root);
  const digestMaxChars = options.digestMaxChars ?? 4_000;

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
          "Create or update a knowledge-base entry. Provide a path ending in " +
          ".md and the full file contents — ideally with `name:` and " +
          "`description:` frontmatter so it indexes cleanly into the map. The " +
          "map refreshes automatically on the next turn.",
        parameters: {
          path: z
            .string()
            .describe(
              "Destination path relative to the KB root (e.g. 'notes/x.md').",
            ),
          content: z.string().describe("Full file contents to write."),
        },
        implementation: async ({ path, content }, { status, warn }) => {
          status(`Writing ${path}`);
          if (!WRITABLE_EXTENSIONS.has(extname(path).toLowerCase())) {
            return `Error: write_node only writes text notes (${[...WRITABLE_EXTENSIONS].join(", ")}); refusing "${path}".`;
          }
          try {
            await fs.writeFile(path, content);
            return `Wrote ${content.length} characters to ${path}.`;
          } catch (err) {
            const m = msg(err);
            warn(`write_node failed: ${m}`);
            return `Error: ${m}`;
          }
        },
      }),
    );
  }

  return tools;
}
