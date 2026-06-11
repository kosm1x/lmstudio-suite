import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cosineSimilarity, VectorStore } from "./vector-store";
import { saveStore, loadStore } from "./persist";

describe("cosineSimilarity", () => {
  it("is 1 for identical, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 when a vector is all zeros", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("returns 0 (not NaN) for non-finite inputs (regression)", () => {
    expect(cosineSimilarity([NaN, 1], [1, 1])).toBe(0);
    expect(cosineSimilarity([Infinity, 1], [1, 1])).toBe(0);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/length mismatch/);
  });
});

describe("VectorStore.query", () => {
  const store = new VectorStore();
  store.addAll([
    { id: "a", vector: [1, 0, 0], text: "apple" },
    { id: "b", vector: [0, 1, 0], text: "banana" },
    { id: "c", vector: [0.9, 0.1, 0], text: "apricot" },
  ]);

  it("ranks by similarity and respects topK", () => {
    const top = store.query([1, 0, 0], 2);
    expect(top.map((s) => s.entry.id)).toEqual(["a", "c"]);
  });

  it("filters by minScore", () => {
    const filtered = store.query([0, 1, 0], 5, 0.5);
    expect(filtered.map((s) => s.entry.id)).toEqual(["b"]);
  });

  it("skips dimension-mismatched entries instead of throwing (regression)", () => {
    const s = new VectorStore();
    s.add({ id: "ok", vector: [1, 0, 0], text: "a" });
    s.add({ id: "bad", vector: [1, 0], text: "b" }); // wrong dimension
    const result = s.query([1, 0, 0], 5);
    expect(result.map((r) => r.entry.id)).toEqual(["ok"]);
  });
});

describe("persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rag-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips through save/load and stays queryable", async () => {
    const store = new VectorStore();
    store.add({ id: "x", vector: [1, 2, 3], text: "hello" });
    const file = join(dir, "store.json");
    await saveStore(store, file);

    const loaded = await loadStore(file);
    expect(loaded?.size).toBe(1);
    expect(loaded?.query([1, 2, 3], 1)[0]?.entry.text).toBe("hello");
  });

  it("returns null for a missing file", async () => {
    expect(await loadStore(join(dir, "nope.json"))).toBeNull();
  });
});
