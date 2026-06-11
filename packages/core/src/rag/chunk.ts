/** Split text into retrieval-sized chunks, preferring paragraph boundaries. */

export interface ChunkOptions {
  /** Target maximum characters per chunk (default 1000). */
  chunkSize?: number;
  /** Characters of overlap when a single paragraph must be hard-split (default 150). */
  overlap?: number;
}

/**
 * Greedily packs paragraphs into chunks no larger than `chunkSize`. Paragraphs
 * longer than `chunkSize` are hard-split into overlapping windows so no content
 * is lost and adjacent windows share context.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const chunkSize = Math.max(1, options.chunkSize ?? 1000);
  const overlap = Math.min(
    Math.max(0, options.overlap ?? 150),
    Math.floor(chunkSize / 2),
  );
  const clean = text.replace(/\r\n/g, "\n").replace(/ /g, " ").trim();
  if (!clean) return [];

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      flush();
      const stride = Math.max(1, chunkSize - overlap);
      for (let i = 0; i < para.length; i += stride) {
        chunks.push(para.slice(i, i + chunkSize));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > chunkSize) {
      flush();
      current = para;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}
