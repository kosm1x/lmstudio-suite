import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson } from "./extract-json";
import { generateStructured, type StructuredModel } from "./structured";
import { cotScaffold, majorityVote } from "./cot";

describe("extractJson", () => {
  it("extracts JSON from a ```json fence with surrounding prose", () => {
    const text = 'Sure!\n```json\n{"a": 1, "b": [2, 3]}\n```\nHope that helps.';
    expect(extractJson(text)).toEqual({ a: 1, b: [2, 3] });
  });

  it("extracts a bare object embedded in prose", () => {
    expect(extractJson('The result is {"ok": true} as shown.')).toEqual({
      ok: true,
    });
  });

  it("is quote/escape aware (braces inside strings don't end the object)", () => {
    expect(extractJson('{"s": "a } b { c"}')).toEqual({ s: "a } b { c" });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow(/No JSON/);
  });

  it("prefers the real payload over an incidental bracket in prose (regression)", () => {
    expect(extractJson('See item [1] below: {"a": 1}')).toEqual({ a: 1 });
  });

  it("falls past a non-JSON code fence to the real json fence (regression)", () => {
    const text =
      '```\nfetchPage(url)\n```\n\n```json\n{"provider":"brave"}\n```';
    expect(extractJson(text)).toEqual({ provider: "brave" });
  });
});

describe("generateStructured", () => {
  const schema = z.object({ answer: z.number() });

  it("retries on invalid output and returns the valid result", async () => {
    let call = 0;
    const model: StructuredModel = {
      respond: async () => {
        call += 1;
        return call === 1
          ? { content: "I think it's around five" } // no JSON -> invalid
          : { content: '{"answer": 5}' };
      },
    };
    expect(await generateStructured(model, "q", schema)).toEqual({ answer: 5 });
    expect(call).toBe(2);
  });

  it("prefers the SDK's already-parsed value when present", async () => {
    const model: StructuredModel = {
      respond: async () => ({ parsed: { answer: 7 }, content: "ignored" }),
    };
    expect(await generateStructured(model, "q", schema)).toEqual({ answer: 7 });
  });

  it("throws after exhausting attempts", async () => {
    const model: StructuredModel = {
      respond: async () => ({ content: "never valid" }),
    };
    await expect(
      generateStructured(model, "q", schema, { maxAttempts: 2 }),
    ).rejects.toThrow(/after 2 attempts/);
  });
});

describe("cotScaffold", () => {
  it("passes through unchanged when off", () => {
    expect(cotScaffold("2+2?", "off")).toBe("2+2?");
  });
  it("appends step-by-step instructions otherwise", () => {
    expect(cotScaffold("2+2?", "concise")).toContain("step by step");
    expect(cotScaffold("2+2?", "full")).toContain("Final answer:");
  });
});

describe("majorityVote", () => {
  it("returns the most common answer with its count", () => {
    expect(majorityVote(["a", "b", "a", "a", "b"])).toEqual({
      answer: "a",
      count: 3,
      total: 5,
    });
  });
  it("returns null for no samples", () => {
    expect(majorityVote([])).toBeNull();
  });
  it("uses a custom key to compare objects", () => {
    const votes = majorityVote([{ n: 1 }, { n: 2 }, { n: 1 }], (o) =>
      String(o.n),
    );
    expect(votes?.answer).toEqual({ n: 1 });
    expect(votes?.count).toBe(2);
  });
});
