/**
 * Web search with a pluggable backend. DuckDuckGo (keyless HTML scrape) is the
 * default so the suite works with zero configuration; Tavily / Brave / SearXNG
 * are available when an API key or instance URL is supplied via config.
 */
import { parse } from "node-html-parser";
import { fetchJson, postForm, type HttpControl } from "./http";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProviderName = "duckduckgo" | "tavily" | "brave" | "searxng";

export interface SearchConfig {
  /** Backend to use (default "duckduckgo"). */
  provider?: SearchProviderName;
  /** API key for "tavily" or "brave". */
  apiKey?: string;
  /** Base URL of a self-hosted SearXNG instance (for "searxng"). */
  searxngUrl?: string;
}

export interface SearchOptions extends HttpControl {
  /** Max results to return (default 5). */
  maxResults?: number;
}

/** Run a web search using the configured provider. */
export async function webSearch(
  query: string,
  config: SearchConfig = {},
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const provider = config.provider ?? "duckduckgo";
  const q = query.trim();
  if (!q) return [];
  switch (provider) {
    case "duckduckgo":
      return searchDuckDuckGo(q, options);
    case "tavily":
      return searchTavily(q, requireKey(config, "tavily"), options);
    case "brave":
      return searchBrave(q, requireKey(config, "brave"), options);
    case "searxng":
      return searchSearxng(q, requireSearxng(config), options);
    default:
      throw new Error(`Unknown search provider: ${provider as string}`);
  }
}

function requireKey(config: SearchConfig, provider: string): string {
  if (!config.apiKey) {
    throw new Error(
      `The "${provider}" search provider requires an API key. Set it in the plugin config or SearchConfig.apiKey.`,
    );
  }
  return config.apiKey;
}

function requireSearxng(config: SearchConfig): string {
  if (!config.searxngUrl) {
    throw new Error(
      `The "searxng" provider requires a base URL. Set SearchConfig.searxngUrl to your instance.`,
    );
  }
  return config.searxngUrl;
}

// --- DuckDuckGo (keyless) -------------------------------------------------

/** Parse DuckDuckGo's HTML results page. Exported for offline unit testing. */
export function parseDuckDuckGoHtml(
  html: string,
  maxResults: number,
): SearchResult[] {
  const root = parse(html);
  const out: SearchResult[] = [];
  for (const result of root.querySelectorAll(".result, .web-result")) {
    const a = result.querySelector(".result__a");
    if (!a) continue;
    const url = normalizeDdgHref(a.getAttribute("href") ?? "");
    const title = a.text.trim();
    const snippet = result.querySelector(".result__snippet")?.text.trim() ?? "";
    if (url && title) out.push({ title, url, snippet });
    if (out.length >= maxResults) break;
  }
  return out;
}

/** DuckDuckGo wraps result links in a `/l/?uddg=<encoded-target>` redirect. */
function normalizeDdgHref(href: string): string {
  let h = href;
  if (h.startsWith("//")) h = "https:" + h;
  try {
    const u = new URL(h, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ?? u.toString();
  } catch {
    return href;
  }
}

async function searchDuckDuckGo(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { maxResults = 5, ...ctl } = options;
  const form = new URLSearchParams({ q: query, kl: "us-en" });
  const html = await postForm("https://html.duckduckgo.com/html/", form, ctl);
  return parseDuckDuckGoHtml(html, maxResults);
}

// --- Tavily ---------------------------------------------------------------

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

async function searchTavily(
  query: string,
  apiKey: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { maxResults = 5, ...ctl } = options;
  const res = await fetchJson<TavilyResponse>(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    },
    ctl,
  );
  return (res.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

// --- Brave ----------------------------------------------------------------

interface BraveResponse {
  web?: {
    results?: Array<{ title?: string; url?: string; description?: string }>;
  };
}

async function searchBrave(
  query: string,
  apiKey: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { maxResults = 5, ...ctl } = options;
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(maxResults));
  const res = await fetchJson<BraveResponse>(
    u.toString(),
    { headers: { "x-subscription-token": apiKey, accept: "application/json" } },
    ctl,
  );
  return (res.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

// --- SearXNG --------------------------------------------------------------

interface SearxngResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

async function searchSearxng(
  query: string,
  baseUrl: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { maxResults = 5, ...ctl } = options;
  const u = new URL("/search", baseUrl);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  const res = await fetchJson<SearxngResponse>(u.toString(), {}, ctl);
  return (res.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}
