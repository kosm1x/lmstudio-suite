/** Fetch a web page and return it as compact Markdown for LLM consumption. */
import { DEFAULT_UA, type HttpControl } from "./http";
import { guardedFetch } from "./guarded-fetch";
import { htmlToMarkdown, extractTitle } from "./html-to-markdown";

export interface FetchPageOptions extends HttpControl {
  /** Truncate the Markdown to this many characters (default 8000). */
  maxChars?: number;
  /** Override the User-Agent header. */
  userAgent?: string;
  /**
   * Allow fetching loopback / private-network / link-local hosts. Default false
   * blocks SSRF against localhost, internal services, and cloud-metadata
   * endpoints — including across redirects. Set true only for trusted use.
   */
  allowPrivateHosts?: boolean;
  /** Maximum redirect hops to follow (default 5). */
  maxRedirects?: number;
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
    allowPrivateHosts = false,
    maxRedirects = 5,
  } = options;

  // The shared guarded path re-validates every redirect hop's host (SSRF).
  const { response: res, finalUrl: current } = await guardedFetch(
    url,
    {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    },
    { allowPrivateHosts, maxRedirects, timeoutMs, signal, userAgent },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${current}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const looksHtml =
    contentType.includes("html") || /^\s*<(!doctype|html)/i.test(body);

  let title = current;
  let markdown: string;
  if (looksHtml) {
    title = extractTitle(body) || current;
    markdown = htmlToMarkdown(body);
  } else {
    markdown = body.trim();
  }

  const truncated = markdown.length > maxChars;
  if (truncated)
    markdown = markdown.slice(0, maxChars).trimEnd() + "\n\n…[truncated]";

  return { url, finalUrl: current, title, markdown, truncated, contentType };
}
