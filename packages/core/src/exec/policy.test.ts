import { describe, it, expect } from "vitest";
import { commandHeads, checkCommandPolicy } from "./policy";

describe("commandHeads", () => {
  it("takes the leading executable of each pipeline/list segment, by basename", () => {
    expect(commandHeads("ls -la")).toEqual(["ls"]);
    expect(commandHeads("cat x | grep y | wc -l")).toEqual([
      "cat",
      "grep",
      "wc",
    ]);
    expect(commandHeads("npm run build && node dist/x.js")).toEqual([
      "npm",
      "node",
    ]);
    expect(commandHeads("/usr/bin/rm -rf x")).toEqual(["rm"]);
    expect(commandHeads("FOO=bar BAZ=1 git status")).toEqual(["git"]);
    expect(commandHeads("")).toEqual([]);
  });
});

describe("checkCommandPolicy", () => {
  it("permits everything with an empty policy", () => {
    expect(checkCommandPolicy("rm -rf /", {})).toBeNull();
  });

  it("rejects a denied head, even mid-pipeline", () => {
    expect(checkCommandPolicy("cat x | rm y", { deny: ["rm"] })).toMatch(
      /deny list/,
    );
    expect(checkCommandPolicy("ls", { deny: ["rm"] })).toBeNull();
  });

  it("with an allow list, every head must be allowed", () => {
    expect(
      checkCommandPolicy("git status", { allow: ["git", "npm"] }),
    ).toBeNull();
    expect(checkCommandPolicy("git log | rm x", { allow: ["git"] })).toMatch(
      /only/,
    );
  });

  it("deny takes precedence over allow", () => {
    expect(checkCommandPolicy("rm x", { allow: ["rm"], deny: ["rm"] })).toMatch(
      /deny list/,
    );
  });
});
