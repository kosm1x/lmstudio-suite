/** Fetch a web page and return it as compact Markdown for LLM consumption. */
import { fetchWithTimeout, DEFAULT_UA, type HttpControl } from "./http";
import { htmlToMarkdown, extractTitle } from "./html-to-markdown";
import { parseHttpUrl } from "./url";

export interface FetchPageOptions extends HttpControl {
  /** Truncate the Markdown to this many characters (default 8000). */
  maxChars?: number;
  /** Override the User-Agent header. */
  userAgent?: string;
}

export interface FetchedPage {
  /** The URL requested. */
  url: string;
  /** The final URL after redirects. */
  finalUrl: string;
  title: string;
  /** Page content rendered as Markdown (HTML) or raw text (non-HTML). */
  markdown: string;
  /** True if `markdown` was cut at `maxChars`. */
  truncated: boolean;
  contentType: string;
}

/** Download `url` and convert it to Markdown. Only http/https is allowed. */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchedPage> {
  const {
    maxChars = 8000,
    userAgent = DEFAULT_UA,
    timeoutMs,
    signal,
  } = options;
  parseHttpUrl(url); // throws on non-http(s) / malformed

  const res = await fetchWithTimeout(
    url,
    {
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    },
    { timeoutMs, signal },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const looksHtml =
    contentType.includes("html") || /^\s*<(!doctype|html)/i.test(body);

  let title = url;
  let markdown: string;
  if (looksHtml) {
    title = extractTitle(body) || url;
    markdown = htmlToMarkdown(body);
  } else {
    markdown = body.trim();
  }

  const truncated = markdown.length > maxChars;
  if (truncated)
    markdown = markdown.slice(0, maxChars).trimEnd() + "\n\n…[truncated]";

  return { url, finalUrl: res.url, title, markdown, truncated, contentType };
}
