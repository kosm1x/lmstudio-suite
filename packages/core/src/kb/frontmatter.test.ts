import { describe, it, expect } from "vitest";
import { parseFrontmatter, fmString, fmArray } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns the whole text as body when there is no fence", () => {
    const r = parseFrontmatter("# Hello\n\nbody");
    expect(r.data).toEqual({});
    expect(r.body).toBe("# Hello\n\nbody");
  });

  it("parses top-level scalars and strips quotes", () => {
    const r = parseFrontmatter(
      [
        "---",
        "name: foo-bar",
        'description: "a quoted desc"',
        "---",
        "body here",
      ].join("\n"),
    );
    expect(fmString(r.data, "name")).toBe("foo-bar");
    expect(fmString(r.data, "description")).toBe("a quoted desc");
    expect(r.body).toBe("body here");
  });

  it("reads type from a nested metadata block", () => {
    const r = parseFrontmatter(
      [
        "---",
        "name: x",
        "metadata:",
        "  node_type: memory",
        "  type: feedback",
        "---",
        "",
      ].join("\n"),
    );
    expect(fmString(r.data, "type")).toBe("feedback");
    // top-level field still wins over metadata when both exist
    const r2 = parseFrontmatter(
      ["---", "type: top", "metadata:", "  type: nested", "---", ""].join("\n"),
    );
    expect(fmString(r2.data, "type")).toBe("top");
  });

  it("parses inline arrays and a tier flag", () => {
    const r = parseFrontmatter(
      ["---", 'tags: [a, "b c", d]', "tier: warm", "---", ""].join("\n"),
    );
    expect(fmArray(r.data, "tags")).toEqual(["a", "b c", "d"]);
    expect(fmString(r.data, "tier")).toBe("warm");
  });

  it("does not throw on an unterminated fence", () => {
    const r = parseFrontmatter("---\nname: x\nno closing fence");
    expect(r.data).toEqual({});
    expect(r.body).toContain("no closing fence");
  });

  it("handles CRLF line endings", () => {
    const r = parseFrontmatter("---\r\nname: win\r\n---\r\nbody\r\nmore");
    expect(fmString(r.data, "name")).toBe("win");
    expect(r.body).toBe("body\nmore");
  });
});
