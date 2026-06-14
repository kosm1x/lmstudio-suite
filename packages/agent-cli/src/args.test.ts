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
  });

  it("resolves --kb to an absolute path", () => {
    const a = parseArgs(["--kb", "notes", "recall"]);
    expect(a.kb).toBe(resolve("notes"));
    expect(a.prompt).toBe("recall");
  });

  it("recognizes --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});
