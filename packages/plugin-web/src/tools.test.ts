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
      cfg({ searchProvider: "duckduckgo", searchApiKey: "", searxngUrl: "" }),
    getPluginConfig: () => cfg({ maxResults: 5, fetchMaxChars: 8000 }),
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

describe("web-tools toolsProvider", () => {
  it("exposes exactly the web_search and fetch_url tools", async () => {
    const tools = await toolsProvider(fakeController());
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => (t as { name: string }).name).sort();
    expect(names).toEqual(["fetch_url", "web_search"]);
  });
});
