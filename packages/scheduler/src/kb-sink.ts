/**
 * Route a scheduled run's result into the knowledge base as a kb-map node.
 *
 * The daemon already writes a raw `runs/<id>/<ts>.md` audit log; this is the
 * opt-in "make it knowledge" path (`--kb <dir>`). It renders the result as a
 * suite-style node — frontmatter (`name` / `description` / `metadata.type` /
 * `tags`) + body — so kb-map indexes it and the model can find past run results
 * later via map_overview / search_map (or the memory RAG over the same dir).
 *
 * `buildScheduledNote` is pure (no fs), so it is unit-tested by round-tripping
 * its output through `scanKbDir` — proving the node it emits is actually indexed.
 */
import type { ScheduleJob } from "@lmstudio-suite/core";

export interface ScheduledNote {
  /** Path relative to the KB root (under `scheduled/`). */
  path: string;
  /** Full file contents: frontmatter + body. */
  content: string;
}

/** Collapse whitespace/newlines so a value stays a single frontmatter scalar. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Filesystem-safe timestamp for the node filename. */
function fsSafeStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

/** A lowercase, separator-free tag derived from text. */
function slugTag(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scheduled"
  );
}

export function buildScheduledNote(
  job: ScheduleJob,
  result: string,
  firedAt: Date,
): ScheduledNote {
  const name = `${job.id}-${fsSafeStamp(firedAt)}`;
  const iso = firedAt.toISOString();
  const description = oneLine(`Scheduled run of "${job.name}" at ${iso}.`);
  const tags = ["scheduled", slugTag(job.id)];

  const frontmatter =
    "---\n" +
    `name: ${name}\n` +
    `description: ${description}\n` +
    "metadata:\n" +
    "  type: note\n" +
    `tags: [${tags.join(", ")}]\n` +
    "---\n";

  const title = oneLine(`${job.name} — ${iso.slice(0, 16).replace("T", " ")}`);
  const body = `\n# ${title}\n\n${result.trim() || "(no output)"}\n`;

  return { path: `scheduled/${name}.md`, content: frontmatter + body };
}
