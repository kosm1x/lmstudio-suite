/**
 * Turn source documents into vector entries: chunk -> batch-embed -> entries.
 *
 * The embedding function is injected so core stays independent of any specific
 * embedding backend; the memory plugin supplies one backed by an LM Studio
 * embedding model.
 */
import { chunkText, type ChunkOptions } from "./chunk";
import type { VectorEntry } from "./vector-store";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface SourceDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** Chunk every document, embed all chunks in one batch, return vector entries. */
export async function indexDocuments(
  docs: SourceDocument[],
  embed: EmbedFn,
  chunkOptions: ChunkOptions = {},
): Promise<VectorEntry[]> {
  const pending: Array<{
    id: string;
    text: string;
    metadata?: Record<string, unknown>;
  }> = [];
  for (const doc of docs) {
    chunkText(doc.text, chunkOptions).forEach((text, i) => {
      pending.push({ id: `${doc.id}#${i}`, text, metadata: doc.metadata });
    });
  }
  if (pending.length === 0) return [];

  const vectors = await embed(pending.map((p) => p.text));
  if (vectors.length !== pending.length) {
    throw new Error(
      `Embed function returned ${vectors.length} vectors for ${pending.length} chunks.`,
    );
  }
  return pending.map((p, i) => ({
    id: p.id,
    vector: vectors[i] ?? [],
    text: p.text,
    metadata: p.metadata,
  }));
}
