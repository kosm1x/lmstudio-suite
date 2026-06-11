import { describe, it, expect } from "vitest";
import { htmlToMarkdown, extractTitle } from "./html-to-markdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs and links", () => {
    const md = htmlToMarkdown(
      `<html><body><h1>Title</h1><p>Hello <a href="https://x.com">world</a></p></body></html>`,
    );
    expect(md).toContain("# Title");
    expect(md).toContain("Hello [world](https://x.com)");
  });

  it("strips scripts, styles and nav boilerplate", () => {
    const md = htmlToMarkdown(
      `<body><nav>menu</nav><script>evil()</script><style>.a{}</style><p>kept</p></body>`,
    );
    expect(md).toBe("kept");
    expect(md).not.toContain("menu");
    expect(md).not.toContain("evil");
  });

  it("renders unordered and ordered lists", () => {
    const md = htmlToMarkdown(
      `<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>`,
    );
    expect(md).toContain("- a");
    expect(md).toContain("- b");
    expect(md).toContain("1. one");
    expect(md).toContain("2. two");
  });

  it("renders inline and fenced code, decoding entities", () => {
    const md = htmlToMarkdown(
      `<p>use <code>a &amp; b</code></p><pre>x = 1 &lt; 2</pre>`,
    );
    expect(md).toContain("`a & b`");
    expect(md).toContain("```");
    expect(md).toContain("x = 1 < 2");
  });

  it("prefers <article> content when present", () => {
    const md = htmlToMarkdown(
      `<body><div>sidebar junk</div><article><p>real</p></article></body>`,
    );
    expect(md).toBe("real");
  });

  it("collapses excess blank lines", () => {
    const md = htmlToMarkdown(`<p>a</p><p>b</p>`);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("does not leak nested <code> tags inside a <pre> fence (regression)", () => {
    const md = htmlToMarkdown(
      `<pre><code class="lang-js">const a = 1;\nconst b = 2;</code></pre>`,
    );
    expect(md).not.toContain("<code");
    expect(md).not.toContain("</code>");
    expect(md).toContain("const a = 1;");
    expect(md).toContain("const b = 2;");
  });
});

describe("extractTitle", () => {
  it("prefers og:title, then <title>, then <h1>", () => {
    expect(
      extractTitle(
        `<head><meta property="og:title" content="OG"><title>T</title></head>`,
      ),
    ).toBe("OG");
    expect(extractTitle(`<head><title>T</title></head>`)).toBe("T");
    expect(extractTitle(`<body><h1>H</h1></body>`)).toBe("H");
  });
});
