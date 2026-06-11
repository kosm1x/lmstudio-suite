/** Fetch a web page and return it as compact Markdown for LLM consumption. */
import { fetchWithTimeout, DEFAULT_UA, type HttpControl } from "./http";
import { htmlToMarkdown, extractTitle } from "./html-to-markdown";
import { isPrivateHost, parseHttpUrl } from "./url";

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

  const guardHost = (u: URL) => {
    if (!allowPrivateHosts && isPrivateHost(u.hostname)) {
      throw new Error(
        `Refusing to fetch a private/loopback host (${u.hostname}). ` +
          `Set allowPrivateHosts to override.`,
      );
    }
  };

  // Follow redirects manually so every hop's host is re-validated (a public URL
  // can otherwise 30x into a private/metadata address).
  let current = url;
  let hops = 0;
  let res: Response;
  for (;;) {
    guardHost(parseHttpUrl(current));
    res = await fetchWithTimeout(
      current,
      {
        redirect: "manual",
        headers: {
          "user-agent": userAgent,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      },
      { timeoutMs, signal },
    );
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (++hops > maxRedirects)
        throw new Error(`Too many redirects fetching ${url}`);
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
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
