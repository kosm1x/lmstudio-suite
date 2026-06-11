/** An in-memory cosine-similarity vector store with JSON serialization. */

/** Cosine similarity of two equal-length vectors. Returns 0 if either is zero. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return 0; // zero or NaN/Inf inputs
  const score = dot / denom;
  return Number.isFinite(score) ? score : 0;
}

export interface VectorEntry {
  id: string;
  vector: number[];
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ScoredEntry {
  entry: VectorEntry;
  score: number;
}

export interface SerializedStore {
  version: 1;
  entries: VectorEntry[];
}

export class VectorStore {
  private entries: VectorEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  add(entry: VectorEntry): void {
    this.entries.push(entry);
  }

  addAll(entries: Iterable<VectorEntry>): void {
    for (const e of entries) this.entries.push(e);
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Return the top-K entries by cosine similarity, filtered by `minScore`.
   * Entries whose vector dimension differs from the query (e.g. left over from a
   * different embedding model) are skipped rather than throwing.
   */
  query(vector: number[], topK = 5, minScore = -Infinity): ScoredEntry[] {
    const scored: ScoredEntry[] = [];
    for (const entry of this.entries) {
      if (entry.vector.length !== vector.length) continue;
      scored.push({ entry, score: cosineSimilarity(vector, entry.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score >= minScore)
      .slice(0, Math.max(0, topK));
  }

  toJSON(): SerializedStore {
    return { version: 1, entries: this.entries };
  }

  static fromJSON(
    data: Partial<SerializedStore> | null | undefined,
  ): VectorStore {
    const store = new VectorStore();
    if (data?.entries) store.addAll(data.entries);
    return store;
  }
}
