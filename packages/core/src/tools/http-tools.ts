/**
 * SDK `tool()` builders for richer web access: a generic HTTP client, a file
 * downloader, and a bounded same-origin crawler. Every request goes through
 * `guardedFetch`, which re-validates each redirect hop against the SSRF guard
 * (default-deny private/loopback/metadata hosts). Responses and downloads are
 * byte-capped; the crawler has hard depth + page limits (no unbounded BFS).
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs } from "../fs/index";
import { guardedFetch, htmlToMarkdown, extractTitle } from "../web/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const HTTP_MAX_BYTES = 2_000_000; // response body cap for http_request
const DOWNLOAD_MAX_BYTES = 25_000_000; // download_file size cap
const CRAWL_MAX_PAGES = 20;
const CRAWL_MAX_DEPTH = 3;
const CRAWL_PER_PAGE_CHARS = 4_000;

export interface HttpToolsOptions {
  /** Root that download_file writes into (path-scoped). */
  root: string;
  /** Allow private/loopback/metadata hosts. Default false (SSRF guard on). */
  allowPrivateHosts?: boolean;
}

/** Read a response body up to maxBytes, marking truncation; never unbounded. */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf.subarray(0, maxBytes),
      truncated: buf.length > maxBytes,
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        truncated = true;
        break;
      }
    }
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const slice = c.subarray(0, out.length - off);
    out.set(slice, off);
    off += slice.length;
  }
  return { bytes: out, truncated };
}

/** Same-origin links from an HTML page, resolved + deduped. */
function sameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1] as string;
    if (/^(mailto:|javascript:|#|tel:|data:)/i.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (u.host !== base.host) continue; // same origin only
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* skip unparseable href */
    }
  }
  return [...out];
}

export function createHttpTools(options: HttpToolsOptions): Tool[] {
  const fs = new ScopedFs(options.root);
  const allowPrivateHosts = options.allowPrivateHosts ?? false;

  return [
    tool({
      name: "http_request",
      description:
        "Make an HTTP request to a REST API and return the status, key response headers, " +
        "and the body (text/JSON, byte-capped). Supports GET/POST/PUT/PATCH/DELETE with " +
        "custom headers and a request body. Private/loopback hosts are blocked by default " +
        "(SSRF). Use for APIs; use fetch_url for reading web pages as Markdown.",
      parameters: {
        url: z.string().describe("Absolute http(s) URL."),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
          .default("GET")
          .describe("HTTP method (default GET)."),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Request headers as a JSON object."),
        body: z
          .string()
          .optional()
          .describe("Request body (for POST/PUT/PATCH)."),
      },
      implementation: async (
        { url, method, headers, body },
        { status, warn },
      ) => {
        status(`${method} ${url}`);
        try {
          const { response, finalUrl } = await guardedFetch(
            url,
            {
              method,
              headers,
              body: method === "GET" || method === "HEAD" ? undefined : body,
            },
            { allowPrivateHosts },
          );
          const { bytes, truncated } = await readCapped(
            response,
            HTTP_MAX_BYTES,
          );
          const text = Buffer.from(bytes).toString("utf8");
          const ctype = response.headers.get("content-type") ?? "";
          const head = `HTTP ${response.status} ${response.statusText}${
            finalUrl !== url ? ` (→ ${finalUrl})` : ""
          }\ncontent-type: ${ctype}`;
          const shown = text || "(empty body)";
          return `${head}\n\n${shown}${truncated ? "\n…[body truncated]" : ""}`;
        } catch (err) {
          warn(`http_request failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "download_file",
      description:
        "Download a file from an http(s) URL into the working directory (path is relative; " +
        "'..' escapes rejected). Size-capped; private/loopback hosts blocked by default. " +
        "Returns the saved path, size, and content-type.",
      parameters: {
        url: z.string().describe("Absolute http(s) URL to download."),
        path: z.string().describe("Relative destination path to save to."),
      },
      implementation: async ({ url, path }, { status, warn }) => {
        status(`Downloading ${url}`);
        try {
          // Validate the destination path up front (before the network call).
          fs.resolvePath(path);
          const { response } = await guardedFetch(
            url,
            {},
            { allowPrivateHosts },
          );
          if (!response.ok) {
            return `Error: HTTP ${response.status} ${response.statusText} for ${url}`;
          }
          // Read one byte past the cap so a file of *exactly* the cap isn't
          // mis-flagged as over-size; reject only if we actually overflowed.
          const { bytes } = await readCapped(response, DOWNLOAD_MAX_BYTES + 1);
          if (bytes.length > DOWNLOAD_MAX_BYTES) {
            return `Error: ${url} exceeds the ${DOWNLOAD_MAX_BYTES}-byte download cap.`;
          }
          await fs.writeBytes(path, bytes);
          const ctype = response.headers.get("content-type") ?? "unknown";
          return `Saved ${bytes.length} bytes to ${path} (content-type: ${ctype}).`;
        } catch (err) {
          warn(`download_file failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "crawl",
      description:
        "Crawl a website starting from a URL, following SAME-ORIGIN links breadth-first up " +
        "to a page and depth limit, and return each page as Markdown. Hard-bounded (no " +
        "runaway crawls). Use to read a small doc site or section; use fetch_url for one page.",
      parameters: {
        url: z.string().describe("Absolute http(s) start URL."),
        max_pages: z
          .number()
          .default(5)
          .describe(`Max pages to fetch (cap ${CRAWL_MAX_PAGES}).`),
        max_depth: z
          .number()
          .default(2)
          .describe(`Max link depth from the start (cap ${CRAWL_MAX_DEPTH}).`),
      },
      implementation: async (
        { url, max_pages, max_depth },
        { status, warn },
      ) => {
        const pageCap = Math.min(Math.max(1, max_pages), CRAWL_MAX_PAGES);
        const depthCap = Math.min(Math.max(0, max_depth), CRAWL_MAX_DEPTH);
        const visited = new Set<string>();
        const queue: Array<{ url: string; depth: number }> = [
          { url, depth: 0 },
        ];
        const sections: string[] = [];
        try {
          while (queue.length > 0 && sections.length < pageCap) {
            const { url: cur, depth } = queue.shift() as {
              url: string;
              depth: number;
            };
            if (visited.has(cur)) continue;
            visited.add(cur);
            status(`Crawling ${cur} (${sections.length + 1}/${pageCap})`);
            let html: string;
            let finalUrl: string;
            try {
              const r = await guardedFetch(cur, {}, { allowPrivateHosts });
              if (!r.response.ok) continue;
              finalUrl = r.finalUrl;
              const { bytes } = await readCapped(r.response, HTTP_MAX_BYTES);
              html = Buffer.from(bytes).toString("utf8");
            } catch {
              continue; // skip a page that fails, keep crawling
            }
            const title = extractTitle(html) || finalUrl;
            const md = htmlToMarkdown(html).slice(0, CRAWL_PER_PAGE_CHARS);
            sections.push(`## ${title}\n<${finalUrl}>\n\n${md}`);
            if (depth < depthCap) {
              for (const link of sameOriginLinks(html, finalUrl)) {
                if (!visited.has(link))
                  queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
          if (sections.length === 0)
            return `Crawl of ${url} returned no pages.`;
          return sections.join("\n\n---\n\n");
        } catch (err) {
          warn(`crawl failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
  ];
}
