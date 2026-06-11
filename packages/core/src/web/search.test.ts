import { describe, it, expect } from "vitest";
import { parseDuckDuckGoHtml, webSearch } from "./search";

const SAMPLE = `
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x">First Result</a>
  <a class="result__snippet">snippet one</a>
</div>
<div class="result">
  <a class="result__a" href="https://direct.example.org/b">Second Result</a>
  <a class="result__snippet">snippet two</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.net/c">Third Result</a>
</div>
`;

describe("parseDuckDuckGoHtml", () => {
  it("decodes the uddg redirect into the real target url", () => {
    const [first] = parseDuckDuckGoHtml(SAMPLE, 5);
    expect(first).toEqual({
      title: "First Result",
      url: "https://example.com/a",
      snippet: "snippet one",
    });
  });

  it("keeps direct hrefs untouched and tolerates missing snippets", () => {
    const results = parseDuckDuckGoHtml(SAMPLE, 5);
    expect(results[1]?.url).toBe("https://direct.example.org/b");
    expect(results[2]).toEqual({
      title: "Third Result",
      url: "https://example.net/c",
      snippet: "",
    });
  });

  it("honours maxResults", () => {
    expect(parseDuckDuckGoHtml(SAMPLE, 2)).toHaveLength(2);
  });
});

describe("webSearch", () => {
  it("returns [] for an empty query without hitting the network", async () => {
    await expect(webSearch("   ")).resolves.toEqual([]);
  });

  it("throws a helpful error when an api-key provider has no key", async () => {
    await expect(webSearch("hi", { provider: "tavily" })).rejects.toThrow(
      /requires an API key/,
    );
  });

  it("throws when searxng has no base url", async () => {
    await expect(webSearch("hi", { provider: "searxng" })).rejects.toThrow(
      /requires a base URL/,
    );
  });
});
