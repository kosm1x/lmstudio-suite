import { describe, it, expect } from "vitest";
import type { ToolsProviderController } from "@lmstudio/sdk";
import { toolsProvider } from "./tools";

/** Minimal fake controller: returns config objects with a `.get()` accessor. */
function fakeController(): ToolsProviderController {
  const cfg = (values: Record<string, unknown>) => ({
    get: (k: string) => values[k],
  });
  return {
    getGlobalPluginConfig: () =>
      cfg({
        searchProvider: "duckduckgo",
        searchApiKey: "",
        searxngUrl: "",
        allowPrivateHosts: false,
      }),
    getPluginConfig: () =>
      cfg({ maxResults: 5, fetchMaxChars: 8000, downloadDir: "" }),
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

describe("web-tools toolsProvider", () => {
  it("exposes the search/fetch tools plus the http tools", async () => {
    const tools = await toolsProvider(fakeController());
    const names = tools.map((t) => (t as { name: string }).name).sort();
    expect(names).toEqual([
      "crawl",
      "download_file",
      "fetch_url",
      "http_request",
      "web_search",
    ]);
  });
});
