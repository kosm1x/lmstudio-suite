/**
 * SDK `tool()` builders for WRITABLE memory — the active half of the `memory`
 * plugin (which only reads via RAG today).
 *
 * `remember` writes a small markdown note (frontmatter + body) into the same
 * knowledge directory the RAG preprocessor indexes, so on the next message the
 * index rebuilds (its signature changes) and the fact becomes retrievable —
 * the read/write loop closes itself, no explicit re-index call. `recall` is a
 * cheap keyword fallback over those notes; `forget` deletes one by id.
 *
 * (Structured, linked notes are kb-map's `write_node`; this is for quick facts.)
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs } from "../fs/index";
import { parseFrontmatter, fmArray } from "../kb/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const RECALL_MAX = 10;

/** A filesystem-safe id derived from the note text (first few words). */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-")
    .slice(0, 60);
  return slug || "note";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildNote(text: string, tags: string[]): string {
  const lines = ["---"];
  if (tags.length > 0) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`created: ${todayIso()}`, "---", "", text.trim(), "");
  return lines.join("\n");
}

export interface MemoryToolsOptions {
  /** Knowledge directory (the same one the RAG preprocessor indexes). */
  root: string;
  /** Subfolder that remembered notes are written to (default "memories"). */
  subdir?: string;
}

export function createMemoryTools(options: MemoryToolsOptions): Tool[] {
  const fs = new ScopedFs(options.root);
  const subdir = (options.subdir ?? "memories").replace(/\/+$/, "");
  const rel = (id: string) => `${subdir}/${id}.md`;

  /** Pick an unused id: the given id, else a slug, disambiguated with -2, -3… */
  async function chooseId(text: string, given?: string): Promise<string> {
    const base = given ? slugify(given) : slugify(text);
    if (given) return base; // explicit id: overwrite-by-id is intentional
    let id = base;
    let n = 2;
    while (await fs.exists(rel(id))) id = `${base}-${n++}`;
    return id;
  }

  return [
    tool({
      name: "remember",
      description:
        "Save a fact to long-term memory so it can be retrieved in later sessions. Use " +
        "when the user shares something worth keeping (a preference, decision, name, path). " +
        "Stored as a markdown note in the knowledge directory, so the memory plugin's " +
        "retrieval picks it up automatically. Pass an existing id to update that note.",
      parameters: {
        text: z
          .string()
          .describe("The fact to remember. Keep it concise but complete."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Optional tags for grouping (e.g. ['preference', 'setup']).",
          ),
        id: z
          .string()
          .optional()
          .describe(
            "Existing note id to overwrite. Omit to create a new note.",
          ),
      },
      implementation: async ({ text, tags = [], id }, { status, warn }) => {
        status("remember");
        if (!text.trim()) return "Error: nothing to remember (empty text).";
        try {
          const noteId = await chooseId(text, id);
          await fs.writeFile(rel(noteId), buildNote(text, tags));
          return `Remembered as "${noteId}".`;
        } catch (err) {
          warn(`remember failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "recall",
      description:
        "Search saved memories by keyword and return the best matches with their ids. " +
        "Use to check what you already know before answering, or to find the id of a note " +
        "to update or forget. Returns an empty result — not an error — when nothing matches.",
      parameters: {
        query: z.string().describe("Keywords to search saved memories for."),
        limit: z
          .number()
          .optional()
          .describe(`Max matches to return (default ${RECALL_MAX}).`),
      },
      implementation: async ({ query, limit }, { status, warn }) => {
        status("recall");
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return "Error: empty query.";
        const cap = Math.min(limit ?? RECALL_MAX, 50);
        try {
          const scored: Array<{ id: string; score: number; line: string }> = [];
          for await (const path of fs.walk(subdir)) {
            if (!path.endsWith(".md")) continue;
            const id = path.slice(subdir.length + 1, -3); // strip "subdir/" and ".md"
            const raw = await fs.readFileFull(path).catch(() => "");
            if (!raw) continue;
            const { data, body } = parseFrontmatter(raw);
            const tags = fmArray(data, "tags");
            const hay = `${id} ${tags.join(" ")} ${body}`.toLowerCase();
            const score = tokens.filter((t) => hay.includes(t)).length;
            if (score === 0) continue;
            const first = body.trim().split("\n")[0] ?? "";
            scored.push({
              id,
              score,
              line: `[${id}] ${first.slice(0, 160)}${tags.length ? ` (${tags.join(", ")})` : ""}`,
            });
          }
          if (scored.length === 0) return `No memories match "${query}".`;
          scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          return scored
            .slice(0, cap)
            .map((s) => s.line)
            .join("\n");
        } catch (err) {
          warn(`recall failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "forget",
      description:
        "Delete a saved memory by its id (use recall to find the id first). Use when a " +
        "fact is wrong or the user asks you to forget it. Irreversible.",
      parameters: {
        id: z.string().describe("The id of the memory note to delete."),
      },
      implementation: async ({ id }, { status, warn }) => {
        status("forget");
        // Sanitize the model-controlled id the same way remember does, so a
        // crafted id like "../note" can't reach a file outside memories/ (the
        // ScopedFs guard only blocks escaping the root, not the subdir). Stored
        // ids are already slugs, so this is idempotent for legitimate ids.
        const safeId = slugify(id);
        try {
          if (!(await fs.exists(rel(safeId))))
            return `No memory with id "${id}". Use recall to list ids.`;
          await fs.remove(rel(safeId));
          return `Forgot "${safeId}".`;
        } catch (err) {
          warn(`forget failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
  ];
}
