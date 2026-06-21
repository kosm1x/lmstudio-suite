/**
 * kb/lint — enforce the graph-validity convention so notes actually link up in
 * a graph view (Obsidian) and in the suite's own KbGraph.
 *
 * Two graphs resolve a `[[link]]` differently, and a note has to satisfy both:
 *   - the suite's KbGraph links by the frontmatter `name:` field (falling back
 *     to the filename) and reads links from the BODY only;
 *   - Obsidian links by the FILENAME (or an `aliases:` entry) and reads links
 *     from the body and frontmatter properties.
 *
 * The overlap that works everywhere is: a body `[[wikilink]]`, with `name:`
 * kept equal to the filename. So the rules enforced here are exactly:
 *   1. if `name:` is present it MUST equal the filename (basename, no ext) —
 *      otherwise kb-map indexes the note under a name no `[[filename]]` resolves;
 *   2. a note must contain at least one body `[[link]]` or it floats unlinked.
 *
 * Folder placement creates no edges in any graph — only links do. These are
 * pure functions over text/graph so they unit-test without the SDK or fs.
 */
import { basename, extname } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { extractLinks } from "./links";
import type { KbGraph } from "./graph";

/** The name a note must carry to resolve in both graphs: its filename, no ext. */
export function expectedNoteName(relPath: string): string {
  return basename(relPath, extname(relPath));
}

/** True when the text opens with a closed `---` frontmatter fence. */
export function hasFrontmatter(text: string): boolean {
  return /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.test(text);
}

/** True when the body references at least one `[[wikilink]]`. */
export function hasBodyLink(body: string): boolean {
  return extractLinks(body).length > 0;
}

export interface NameFix {
  /** The `name:` value found (undefined when no name line existed). */
  from?: string;
  /** The value it was set to (the expected filename-derived name). */
  to: string;
}

/**
 * Force the frontmatter `name:` to `expected`, operating only inside the fence.
 * Replaces an existing `name:` line, or inserts one right after the opening
 * `---`. Returns the (possibly unchanged) text and what changed. Returns
 * `changed: false` with no edit when there is no frontmatter fence to edit.
 */
export function setFrontmatterName(
  text: string,
  expected: string,
): { text: string; changed: boolean; fix?: NameFix } {
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return { text, changed: false };

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { text, changed: false };

  for (let i = 1; i < close; i++) {
    const m = (lines[i] ?? "").match(/^name:[ \t]*(.*)$/);
    if (m) {
      const current = (m[1] ?? "").trim().replace(/^["']|["']$/g, "");
      if (current === expected) return { text, changed: false };
      lines[i] = `name: ${expected}`;
      return {
        text: lines.join("\n"),
        changed: true,
        fix: { from: current, to: expected },
      };
    }
  }
  // No name line in the header — insert one just after the opening fence.
  lines.splice(1, 0, `name: ${expected}`);
  return { text: lines.join("\n"), changed: true, fix: { to: expected } };
}

export interface WriteCheck {
  /** The content to actually write (name auto-corrected when possible). */
  content: string;
  /** Set when the `name:` field was rewritten to match the filename. */
  nameFixed?: NameFix;
  /** Blocking problems — when non-empty, the note must NOT be written as-is. */
  errors: string[];
}

/**
 * Gate a note before it is written: require frontmatter, auto-correct `name:`
 * to the filename, and require at least one body `[[link]]`. The name fix is
 * applied silently (it's deterministic and unambiguous); the missing-frontmatter
 * and missing-link problems are returned as `errors` because only the author
 * can supply the right content. Callers refuse the write when `errors` is
 * non-empty and surface them to the model.
 */
export function checkNoteForWrite(
  content: string,
  relPath: string,
): WriteCheck {
  const expected = expectedNoteName(relPath);
  const errors: string[] = [];

  if (!hasFrontmatter(content)) {
    errors.push(
      "missing YAML frontmatter — begin the file with a `---` block holding " +
        `name: ${expected} / description / metadata.type / tags.`,
    );
    return { content, errors };
  }

  const named = setFrontmatterName(content, expected);
  const { body } = parseFrontmatter(named.text);
  if (!hasBodyLink(body)) {
    errors.push(
      "no [[links]] in the body — a note with no link floats unlinked in the " +
        "graph. Add a `## Related` section linking the project index or a " +
        "parent note (e.g. `- [[some-note]]`), then save again.",
    );
  }

  const check: WriteCheck = { content: named.text, errors };
  if (named.fix) check.nameFixed = named.fix;
  return check;
}

export type GraphIssueKind = "name-mismatch" | "isolated" | "dangling";

export interface GraphIssue {
  path: string;
  kind: GraphIssueKind;
  detail: string;
}

/**
 * Audit a whole KbGraph for the convention. Reports, per node:
 *   - name-mismatch: `name:` ≠ filename (kb-map would index it unreachably);
 *   - isolated: no outgoing AND no incoming links — a true floating dot;
 *   - dangling: links to a name that has no note yet.
 * A note that is only linked-TO is connected, so it is NOT flagged isolated.
 */
export function lintGraph(graph: KbGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const node of graph.nodes) {
    const expected = expectedNoteName(node.path);
    if (node.name !== expected) {
      issues.push({
        path: node.path,
        kind: "name-mismatch",
        detail: `name "${node.name}" ≠ filename "${expected}" — set name: ${expected} (kb-map links by name, Obsidian by filename).`,
      });
    }
    const incoming = graph.incoming(node).length;
    if (node.links.length === 0 && incoming === 0) {
      issues.push({
        path: node.path,
        kind: "isolated",
        detail: "no [[links]] out and nothing links in — floats unlinked.",
      });
    }
    const dangling = graph.outgoing(node).dangling;
    if (dangling.length > 0) {
      issues.push({
        path: node.path,
        kind: "dangling",
        detail: `links to non-existent note(s): ${dangling.join(", ")}.`,
      });
    }
  }
  return issues;
}
