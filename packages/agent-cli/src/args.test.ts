import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("joins positional words into the prompt", () => {
    expect(parseArgs(["summarize", "this", "repo"]).prompt).toBe(
      "summarize this repo",
    );
  });

  it("parses flags and the trailing prompt", () => {
    const a = parseArgs([
      "--model",
      "qwen",
      "--max-rounds",
      "3",
      "--shell",
      "do",
      "it",
    ]);
    expect(a.model).toBe("qwen");
    expect(a.maxRounds).toBe(3);
    expect(a.shell).toBe(true);
    expect(a.prompt).toBe("do it");
  });

  it("applies defaults", () => {
    const a = parseArgs(["hi"]);
    expect(a.maxRounds).toBe(8);
    expect(a.shell).toBe(false);
    expect(a.model).toBeUndefined();
    expect(a.kb).toBeUndefined();
    expect(a.memory).toBeUndefined();
    expect(a.data).toBe(false);
    expect(a.approve).toBe(false);
    expect(a.trace).toBeUndefined();
  });

  it("parses --approve and --trace", () => {
    const a = parseArgs(["--approve", "--trace", "t.jsonl", "go"]);
    expect(a.approve).toBe(true);
    expect(a.trace).toBe(resolve("t.jsonl"));
    expect(a.prompt).toBe("go");
  });

  it("resolves --kb and --memory to absolute paths", () => {
    const a = parseArgs([
      "--kb",
      "notes",
      "--memory",
      "mem",
      "--data",
      "recall",
    ]);
    expect(a.kb).toBe(resolve("notes"));
    expect(a.memory).toBe(resolve("mem"));
    expect(a.data).toBe(true);
    expect(a.prompt).toBe("recall");
  });

  it("recognizes --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});
