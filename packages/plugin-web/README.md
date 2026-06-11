# web-tools

Give any local model **live web access** — search the web and read pages — as callable tools.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Tools

| Tool         | What it does                                                            |
| ------------ | ----------------------------------------------------------------------- |
| `web_search` | Search the web; returns a ranked list of results (title, URL, snippet). |
| `fetch_url`  | Fetch an http/https page and return its main content as clean Markdown. |

Typical flow: the model calls `web_search` to find sources, then `fetch_url` to read the most relevant one.

## Configuration

**Global (app-wide):**

- **Web search provider** — `DuckDuckGo` (no key, default), `Tavily`, `Brave`, or `SearXNG`.
- **Search API key** — required for Tavily/Brave (stored protected).
- **SearXNG base URL** — for a self-hosted SearXNG instance.
- **Allow fetching private/localhost hosts** — off by default; blocks SSRF to loopback, internal services, and cloud-metadata endpoints (enforced across redirects). Enable only to let the model read your own local services.

**Per-chat:**

- **Max search results** (default 5)
- **Max characters per fetched page** (default 8000)

## Use

Enable `web-tools` in a chat with a tool-capable model, then ask something that needs current information — the model will call `web_search` / `fetch_url` on its own.

MIT licensed.
