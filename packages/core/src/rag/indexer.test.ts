import { describe, expect, it } from "vitest";
import { indexDocuments, type EmbedFn } from "./indexer";

// Fake embedder: maps each text to a 1-D vector of its length (deterministic).
const fakeEmbed: EmbedFn = async (texts) => texts.map((t) => [t.length]);

describe("indexDocuments", () => {
  it("chunks, batch-embeds, and ids chunks as <docId>#<n>", async () => {
    const docs = [{ id: "doc1", text: "aaaa\n\nbbbb\n\ncccc" }];
    const entries = await indexDocuments(docs, fakeEmbed, { chunkSize: 8 });
    expect(entries.length).toBeGreaterThan(1);
    expect(entries[0]?.id).toBe("doc1#0");
    expect(entries.every((e) => e.vector.length === 1)).toBe(true);
  });

  it("returns [] when there is nothing to index", async () => {
    expect(await indexDocuments([{ id: "d", text: "   " }], fakeEmbed)).toEqual(
      [],
    );
  });

  it("throws if the embedder returns the wrong number of vectors", async () => {
    const badEmbed: EmbedFn = async () => [[1]];
    await expect(
      indexDocuments([{ id: "d", text: "a\n\nb\n\nc" }], badEmbed, {
        chunkSize: 1,
      }),
    ).rejects.toThrow(/vectors for/);
  });

  it("preserves document metadata on each chunk", async () => {
    const entries = await indexDocuments(
      [{ id: "d", text: "hello", metadata: { source: "f.md" } }],
      fakeEmbed,
    );
    expect(entries[0]?.metadata).toEqual({ source: "f.md" });
  });
});
