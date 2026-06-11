/**
 * Config schematics for the web-tools plugin.
 *
 * - Global config (app-wide): search provider + API keys / SearXNG URL.
 * - Per-chat config: result count + page size, which affect context length.
 */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "searchProvider",
    "select",
    {
      displayName: "Web search provider",
      hint: "Backend used by web_search. DuckDuckGo requires no API key.",
      options: [
        { value: "duckduckgo", displayName: "DuckDuckGo (no key)" },
        { value: "tavily", displayName: "Tavily (API key)" },
        { value: "brave", displayName: "Brave Search (API key)" },
        { value: "searxng", displayName: "SearXNG (self-hosted URL)" },
      ],
    },
    "duckduckgo",
  )
  .field(
    "searchApiKey",
    "string",
    {
      displayName: "Search API key",
      hint: "Required for Tavily or Brave. Ignored for DuckDuckGo / SearXNG.",
      isProtected: true,
      placeholder: "tvly-… or BSA…",
    },
    "",
  )
  .field(
    "searxngUrl",
    "string",
    {
      displayName: "SearXNG base URL",
      hint: "Base URL of your SearXNG instance (used when provider = SearXNG).",
      placeholder: "https://searx.example.com",
    },
    "",
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "maxResults",
    "numeric",
    {
      displayName: "Max search results",
      hint: "How many results web_search returns.",
      int: true,
      min: 1,
      max: 20,
      slider: { min: 1, max: 20, step: 1 },
    },
    5,
  )
  .field(
    "fetchMaxChars",
    "numeric",
    {
      displayName: "Max characters per fetched page",
      hint: "fetch_url truncates pages longer than this to protect the context window.",
      int: true,
      min: 500,
      max: 50_000,
    },
    8_000,
  )
  .build();
