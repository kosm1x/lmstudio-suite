import { describe, expect, it } from "vitest";
import type { ScoredEntry } from "@lmstudio-suite/core";
import { buildContextBlock } from "./context";

const hit = (
  id: string,
  text: string,
  score: number,
  source?: string,
): ScoredEntry => ({
  entry: { id, text, vector: [], metadata: source ? { source } : undefined },
  score,
});

describe("buildContextBlock", () => {
  it("includes the source label and similarity score", () => {
    const block = buildContextBlock(
      [hit("d#0", "the answer is 42", 0.91, "facts.md")],
      1000,
    );
    expect(block).toContain("[facts.md]");
    expect(block).toContain("similarity 0.91");
    expect(block).toContain("the answer is 42");
  });

  it("falls back to the entry id when no source metadata", () => {
    expect(buildContextBlock([hit("doc#3", "x", 0.5)], 1000)).toContain(
      "[doc#3]",
    );
  });

  it("stops adding snippets past maxChars but always keeps at least one", () => {
    const hits = [hit("a", "x".repeat(50), 0.9), hit("b", "y".repeat(50), 0.8)];
    const block = buildContextBlock(hits, 40);
    expect(block).toContain("x".repeat(50));
    expect(block).not.toContain("y".repeat(50));
  });
});
