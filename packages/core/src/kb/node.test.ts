import { describe, it, expect } from "vitest";
import { fileToNode, deriveHook, topDir } from "./node";

const stat = { mtimeMs: 1000, size: 50 };

describe("topDir", () => {
  it("returns the first segment, or '.' for root files", () => {
    expect(topDir("lessons/foo.md")).toBe("lessons");
    expect(topDir("a/b/c.md")).toBe("a");
    expect(topDir("README.md")).toBe(".");
  });
});

describe("deriveHook", () => {
  it("uses the first heading, stripped of hashes", () => {
    expect(deriveHook("\n\n## Title Here\n\nbody")).toBe("Title Here");
  });
  it("falls back to the first prose line, skipping fences/rules", () => {
    expect(deriveHook("```\ncode\n```\n---\nreal line")).toBe("real line");
  });
  it("returns empty string for an empty body", () => {
    expect(deriveHook("\n\n   \n")).toBe("");
  });
});

describe("fileToNode", () => {
  it("builds a rich node from frontmatter", () => {
    const text = [
      "---",
      "name: outreach-tempban",
      'description: "WA fingerprint ban"',
      "metadata:",
      "  type: feedback",
      "---",
      "Body links [[transient-failure]] and [[3strike-rule]].",
    ].join("\n");
    const n = fileToNode("lessons/outreach.md", text, stat);
    expect(n.name).toBe("outreach-tempban");
    expect(n.description).toBe("WA fingerprint ban");
    expect(n.type).toBe("feedback");
    expect(n.dir).toBe("lessons");
    expect(n.tier).toBe("index");
    expect(n.links).toEqual(["transient-failure", "3strike-rule"]);
  });

  it("derives name + hook for a plain file", () => {
    const n = fileToNode("notes/raw.md", "# Raw Heading\n\ndetail", stat);
    expect(n.name).toBe("raw");
    expect(n.description).toBe("Raw Heading");
  });

  it("marks files in warm folders as warm tier", () => {
    const n = fileToNode("archive/old.md", "# old", stat);
    expect(n.tier).toBe("warm");
  });

  it("honors an explicit tier flag over the folder default", () => {
    const text = ["---", "name: x", "tier: warm", "---", "y"].join("\n");
    const n = fileToNode("lessons/x.md", text, stat);
    expect(n.tier).toBe("warm");
  });

  it("respects a custom warmFolders option", () => {
    const n = fileToNode("drafts/d.md", "# d", stat, {
      warmFolders: ["drafts"],
    });
    expect(n.tier).toBe("warm");
  });
});
