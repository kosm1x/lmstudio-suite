/**
 * SDK `tool()` builders for web access, shared by the web-tools plugin and the
 * agent CLI so both surfaces use one implementation.
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { fetchPage, webSearch, type SearchConfig } from "../web/index";

export interface WebToolsOptions {
  search: SearchConfig;
  /** Max results from web_search (default 5). */
  maxResults?: number;
  /** Max characters fetch_url returns per page (default 8000). */
  fetchMaxChars?: number;
  /**
   * Allow fetch_url to reach loopback/private/link-local hosts. Default false
   * (blocks SSRF to localhost, internal services, and cloud metadata).
   */
  allowPrivateHosts?: boolean;
}

export function createWebTools(options: WebToolsOptions): Tool[] {
  const maxResults = options.maxResults ?? 5;
  const fetchMaxChars = options.fetchMaxChars ?? 8000;
  const allowPrivateHosts = options.allowPrivateHosts ?? false;

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
        const results = await webSearch(query, options.search, {
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
        const page = await fetchPage(url, {
          maxChars: fetchMaxChars,
          signal,
          allowPrivateHosts,
        });
        return `# ${page.title}\n<${page.finalUrl}>\n\n${page.markdown}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warn(`fetch_url failed: ${message}`);
        return `Error fetching ${url}: ${message}`;
      }
    },
  });

  return [webSearchTool, fetchUrlTool];
}
