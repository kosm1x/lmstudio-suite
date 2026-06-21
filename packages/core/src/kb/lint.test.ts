import { describe, it, expect } from "vitest";
import {
  expectedNoteName,
  hasFrontmatter,
  hasBodyLink,
  setFrontmatterName,
  checkNoteForWrite,
  lintGraph,
} from "./lint";
import { KbGraph } from "./graph";
import type { KbNode } from "./node";

/** Minimal KbNode for graph assembly; links resolve against `name`. */
function node(path: string, name: string, links: string[] = []): KbNode {
  return {
    path,
    name,
    description: "",
    tier: "index",
    tags: [],
    links,
    dir: "",
    mtimeMs: 0,
    size: 0,
  };
}

describe("expectedNoteName", () => {
  it("is the basename without extension", () => {
    expect(expectedNoteName("docs/mission-vision.md")).toBe("mission-vision");
    expect(expectedNoteName("README.md")).toBe("README");
  });
});

describe("hasFrontmatter / hasBodyLink", () => {
  it("detects a closed frontmatter fence", () => {
    expect(hasFrontmatter("---\nname: x\n---\nbody")).toBe(true);
    expect(hasFrontmatter("no fence here")).toBe(false);
    expect(hasFrontmatter("---\nname: x\nnever closed")).toBe(false);
  });

  it("detects a body wikilink", () => {
    expect(hasBodyLink("see [[other]]")).toBe(true);
    expect(hasBodyLink("no links at all")).toBe(false);
  });
});

describe("setFrontmatterName", () => {
  it("replaces a mismatched name line", () => {
    const r = setFrontmatterName(
      "---\nname: wrong\ntags: [a]\n---\nbody",
      "right",
    );
    expect(r.changed).toBe(true);
    expect(r.fix).toEqual({ from: "wrong", to: "right" });
    expect(r.text).toContain("name: right");
    expect(r.text).not.toContain("name: wrong");
  });

  it("is a no-op when the name already matches (quotes tolerated)", () => {
    expect(setFrontmatterName('---\nname: "ok"\n---\nb', "ok").changed).toBe(
      false,
    );
  });

  it("inserts a name line when none exists", () => {
    const r = setFrontmatterName("---\ntags: [a]\n---\nbody", "fresh");
    expect(r.changed).toBe(true);
    expect(r.fix).toEqual({ to: "fresh" });
    expect(r.text).toBe("---\nname: fresh\ntags: [a]\n---\nbody");
  });

  it("does nothing without a fence to edit", () => {
    expect(setFrontmatterName("plain text", "x")).toEqual({
      text: "plain text",
      changed: false,
    });
  });

  it("does not match a different key that ends in 'name'", () => {
    const r = setFrontmatterName("---\nnickname: nick\n---\nb", "real");
    expect(r.fix).toEqual({ to: "real" }); // inserted, not a replace of nickname
    expect(r.text).toContain("nickname: nick");
    expect(r.text).toContain("name: real");
  });

  it("leaves a nested metadata.name alone and adds a top-level name", () => {
    const r = setFrontmatterName(
      "---\nmetadata:\n  name: inner\n---\nb",
      "top",
    );
    expect(r.text).toContain("  name: inner"); // nested key untouched
    expect(r.text).toMatch(/^---\nname: top\n/); // top-level inserted
  });
});

describe("checkNoteForWrite", () => {
  it("blocks a note with no frontmatter", () => {
    const r = checkNoteForWrite("# Title\nbody [[x]]", "docs/a.md");
    expect(r.errors[0]).toContain("missing YAML frontmatter");
  });

  it("blocks a note with frontmatter but no body link", () => {
    const r = checkNoteForWrite("---\nname: a\n---\n# A\njust prose", "a.md");
    expect(r.errors.some((e) => e.includes("no [[links]]"))).toBe(true);
  });

  it("auto-corrects name to the filename and passes when a link exists", () => {
    const r = checkNoteForWrite(
      "---\nname: misnamed\n---\n# A\nsee [[index]]",
      "docs/mission-vision.md",
    );
    expect(r.errors).toEqual([]);
    expect(r.nameFixed).toEqual({ from: "misnamed", to: "mission-vision" });
    expect(r.content).toContain("name: mission-vision");
  });

  it("passes a fully-valid note unchanged", () => {
    const ok = "---\nname: a\ndescription: d\n---\n# A\nlinks [[b]]";
    const r = checkNoteForWrite(ok, "a.md");
    expect(r.errors).toEqual([]);
    expect(r.nameFixed).toBeUndefined();
    expect(r.content).toBe(ok);
  });

  it("ignores a [[link]] that is only in the frontmatter, not the body", () => {
    // header-only link proves extractLinks runs on the body, not the whole file.
    const r = checkNoteForWrite(
      '---\nname: a\nrelated: "[[b]]"\n---\n# A\nno body links here',
      "a.md",
    );
    expect(r.errors.some((e) => e.includes("no [[links]]"))).toBe(true);
  });

  it("ignores a name: line that appears in the body", () => {
    // a `name:` in prose must not satisfy the frontmatter; one is inserted.
    const r = checkNoteForWrite(
      "---\ndescription: d\n---\n# A\nname: notmeta\nsee [[b]]",
      "real.md",
    );
    expect(r.errors).toEqual([]);
    expect(r.content).toMatch(/^---\nname: real\n/);
  });

  it("handles CRLF line endings without a false rejection", () => {
    const r = checkNoteForWrite(
      "---\r\nname: a\r\n---\r\n# A\r\nlinks [[b]]",
      "a.md",
    );
    expect(r.errors).toEqual([]);
  });
});

describe("lintGraph", () => {
  it("flags a name ≠ filename mismatch", () => {
    const g = new KbGraph([
      node("docs/a.md", "aardvark", ["b"]),
      node("b.md", "b"),
    ]);
    const issues = lintGraph(g);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "docs/a.md", kind: "name-mismatch" }),
    );
  });

  it("flags an isolated note but not one that is only linked-to", () => {
    // a → b. `a` has an outgoing link; `b` has only an incoming link.
    // `lonely` has neither.
    const g = new KbGraph([
      node("a.md", "a", ["b"]),
      node("b.md", "b"),
      node("lonely.md", "lonely"),
    ]);
    const kinds = lintGraph(g);
    expect(kinds).toContainEqual(
      expect.objectContaining({ path: "lonely.md", kind: "isolated" }),
    );
    expect(kinds.find((i) => i.path === "b.md" && i.kind === "isolated")).toBe(
      undefined,
    );
    expect(kinds.find((i) => i.path === "a.md" && i.kind === "isolated")).toBe(
      undefined,
    );
  });

  it("flags a dangling link to a non-existent note", () => {
    const g = new KbGraph([node("a.md", "a", ["ghost"])]);
    expect(lintGraph(g)).toContainEqual(
      expect.objectContaining({ path: "a.md", kind: "dangling" }),
    );
  });

  it("is silent on a clean two-note graph", () => {
    const g = new KbGraph([node("a.md", "a", ["b"]), node("b.md", "b", ["a"])]);
    expect(lintGraph(g)).toEqual([]);
  });

  it("does not flag a note as isolated when its only link is dangling", () => {
    // `a` links out to a ghost — an outgoing edge exists, so it's not floating
    // (Obsidian draws an edge to the unresolved node); it's only `dangling`.
    const g = new KbGraph([node("a.md", "a", ["ghost"])]);
    const issues = lintGraph(g);
    expect(issues.some((i) => i.kind === "dangling")).toBe(true);
    expect(issues.some((i) => i.kind === "isolated")).toBe(false);
  });
});
