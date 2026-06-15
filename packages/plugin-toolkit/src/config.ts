/** Config for the toolkit meta-plugin: a working dir + web settings + group toggles. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "workingDir",
    "string",
    {
      displayName: "Working directory",
      hint: "Absolute path the file / data / memory / kb-map / download tools operate in (supports a leading ~). Leave blank to use the chat's auto dir, falling back to a temp sandbox.",
      placeholder: "~/projects/my-app",
    },
    "",
  )
  .field(
    "searchProvider",
    "select",
    {
      displayName: "Web search provider",
      hint: "Backend for web_search (when the web group is on). DuckDuckGo needs no key.",
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
      hint: "Required for Tavily or Brave.",
      isProtected: true,
    },
    "",
  )
  .field(
    "searxngUrl",
    "string",
    {
      displayName: "SearXNG base URL",
      placeholder: "https://searx.example.com",
    },
    "",
  )
  .field(
    "allowPrivateHosts",
    "boolean",
    {
      displayName: "Allow private/localhost hosts",
      hint: "Off by default to block SSRF (localhost, internal services, cloud metadata).",
      warning: "Enabling this lets the model reach loopback/internal URLs.",
    },
    false,
  )
  .build();

/** One boolean per tool group. Read-leaning groups default on; mutating ones off. */
export const chatConfigSchematics = createConfigSchematics()
  .field(
    "enableWeb",
    "boolean",
    { displayName: "Web search + fetch", hint: "web_search, fetch_url." },
    true,
  )
  .field(
    "enableHttp",
    "boolean",
    { displayName: "HTTP client", hint: "http_request, download_file, crawl." },
    false,
  )
  .field(
    "enableFs",
    "boolean",
    {
      displayName: "Filesystem",
      hint: "read/write/edit/search/glob/list/stat/move/mkdir/delete (scoped to the working dir).",
    },
    true,
  )
  .field(
    "enableShell",
    "boolean",
    {
      displayName: "Shell (run_shell)",
      hint: "Run shell commands in the working directory. Off by default.",
      warning: "run_shell executes with your privileges — not a sandbox.",
    },
    false,
  )
  .field(
    "enableData",
    "boolean",
    {
      displayName: "Data + math",
      hint: "calculator, parse_json, read_csv, query_sqlite.",
    },
    true,
  )
  .field(
    "enableMemory",
    "boolean",
    { displayName: "Writable memory", hint: "remember, recall, forget." },
    false,
  )
  .field(
    "enableKbMap",
    "boolean",
    {
      displayName: "KB map navigation",
      hint: "map_overview, search_map, read_node, follow_links over the working dir.",
    },
    false,
  )
  .build();
