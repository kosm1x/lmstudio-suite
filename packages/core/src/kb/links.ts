/** Extract `[[wikilink]]` targets from a document body. */

const LINK_RE = /\[\[([^\]\n]+)\]\]/g;

/**
 * Return the unique, order-preserving list of names referenced by `[[name]]`
 * markers. A pipe alias (`[[name|label]]`) keeps only the `name` half. Empty
 * targets are dropped. Dangling targets (no matching node) are intentionally
 * kept here — resolution happens against the graph, not at extraction time.
 */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(LINK_RE)) {
    const raw = (match[1] ?? "").split("|")[0] ?? "";
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
