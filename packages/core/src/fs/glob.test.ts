import { describe, it, expect } from "vitest";
import { globToRegExp, matchesGlob } from "./glob";

describe("globToRegExp", () => {
  it("* matches within a single segment only", () => {
    expect(matchesGlob("foo.ts", "*.ts")).toBe(true);
    expect(matchesGlob("a/foo.ts", "*.ts")).toBe(false); // * does not cross '/'
    expect(matchesGlob("foo.js", "*.ts")).toBe(false);
  });

  it("** crosses directories (with a trailing slash, zero or more segments)", () => {
    expect(matchesGlob("foo.ts", "**/*.ts")).toBe(true); // zero segments
    expect(matchesGlob("a/foo.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("a/b/c/foo.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("a/b/foo.js", "**/*.ts")).toBe(false);
  });

  it("anchors a leading directory", () => {
    expect(matchesGlob("src/a/foo.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src/foo.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("lib/foo.ts", "src/**/*.ts")).toBe(false);
  });

  it("** at the end matches anything below", () => {
    expect(matchesGlob("src/a/b.ts", "src/**")).toBe(true);
    expect(matchesGlob("src/a", "src/**")).toBe(true);
    expect(matchesGlob("lib/a", "src/**")).toBe(false);
  });

  it("? matches exactly one non-separator char", () => {
    expect(matchesGlob("a.ts", "?.ts")).toBe(true);
    expect(matchesGlob("ab.ts", "?.ts")).toBe(false);
    expect(matchesGlob("/.ts", "?.ts")).toBe(false);
  });

  it("treats regex metacharacters literally", () => {
    expect(matchesGlob("a.b+c.ts", "a.b+c.ts")).toBe(true);
    expect(matchesGlob("axbxc.ts", "a.b+c.ts")).toBe(false); // '.' is literal, not 'any'
  });

  it("globToRegExp returns an anchored pattern", () => {
    const re = globToRegExp("*.ts");
    expect(re.source.startsWith("^")).toBe(true);
    expect(re.source.endsWith("$")).toBe(true);
  });
});
