/** The web_search + fetch_url tools, backed by @lmstudio-suite/core. */
import { tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";
import {
  webSearch,
  fetchPage,
  type SearchConfig,
  type SearchProviderName,
} from "@lmstudio-suite/core/web";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);

  const searchConfig: SearchConfig = {
    provider: global.get("searchProvider") as SearchProviderName,
    apiKey: global.get("searchApiKey") || undefined,
    searxngUrl: global.get("searxngUrl") || undefined,
  };
  const maxResults = chat.get("maxResults");
  const fetchMaxChars = chat.get("fetchMaxChars");

  const webSearchTool = tool({
    name: "web_search",
    description:
      "Search the web and return a ranked list of results, each with a title, URL, and snippet. " +
      "Use this to find current information, facts, or pages to open with fetch_url.",
    parameters: {
      query: z
        .string()
        .describe("What to search for, as a natural-language query."),
    },
    implementation: async ({ query }, { status, warn, signal }) => {
      status(`Searching the web for: ${query}`);
      try {
        const results = await webSearch(query, searchConfig, {
          maxResults,
          signal,
        });
        if (results.length === 0) return "No results found.";
        return results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
          )
          .join("\n\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warn(`web_search failed: ${message}`);
        return `Error: web search failed (${message}).`;
      }
    },
  });

  const fetchUrlTool = tool({
    name: "fetch_url",
    description:
      "Fetch an http/https web page and return its main content as Markdown. " +
      "Use after web_search to read a specific result, or to read a known URL directly.",
    parameters: {
      url: z.string().describe("The absolute http(s) URL of the page to read."),
    },
    implementation: async ({ url }, { status, warn, signal }) => {
      status(`Fetching ${url}`);
      try {
        const page = await fetchPage(url, { maxChars: fetchMaxChars, signal });
        const header = `# ${page.title}\n<${page.finalUrl}>\n\n`;
        return header + page.markdown;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warn(`fetch_url failed: ${message}`);
        return `Error fetching ${url}: ${message}`;
      }
    },
  });

  return [webSearchTool, fetchUrlTool];
}
