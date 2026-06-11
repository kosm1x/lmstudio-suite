import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns [] for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkText("hello world", { chunkSize: 100 })).toEqual([
      "hello world",
    ]);
  });

  it("packs paragraphs without exceeding chunkSize", () => {
    const text = ["aaaa", "bbbb", "cccc", "dddd"].join("\n\n");
    const chunks = chunkText(text, { chunkSize: 12 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(12);
  });

  it("hard-splits an over-long paragraph into overlapping windows", () => {
    const para = "x".repeat(250);
    const chunks = chunkText(para, { chunkSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    // total content (minus overlap) covers the whole paragraph
    expect(chunks.join("").length).toBeGreaterThanOrEqual(250);
  });
});
