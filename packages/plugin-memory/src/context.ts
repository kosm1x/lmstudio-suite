/** Format retrieved snippets into a context block prepended to the user query. */
import type { ScoredEntry } from "@lmstudio-suite/core";

export function buildContextBlock(
  hits: ScoredEntry[],
  maxChars: number,
): string {
  const blocks: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const source =
      (hit.entry.metadata?.["source"] as string | undefined) ?? hit.entry.id;
    const snippet = `[${source}] (similarity ${hit.score.toFixed(2)})\n${hit.entry.text}`;
    if (used + snippet.length > maxChars && blocks.length > 0) break;
    blocks.push(snippet);
    used += snippet.length;
  }
  return [
    "Relevant context retrieved from the user's knowledge base. Use it if helpful; ignore it if not relevant:",
    ...blocks,
  ].join("\n\n---\n\n");
}
