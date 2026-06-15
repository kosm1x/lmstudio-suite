import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpTools } from "./http-tools";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createHttpTools>[number]["implementation"]>
>[1];

let root = "";
async function call(
  name: string,
  params: Record<string, unknown>,
  allowPrivateHosts = false,
): Promise<string> {
  const t = createHttpTools({ root, allowPrivateHosts }).find(
    (x) => x.name === name,
  );
  if (!t) throw new Error(`tool ${name} not found`);
  return (await t.implementation(params, ctx)) as string;
}

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "http-tools-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("createHttpTools", () => {
  it("exposes http_request / download_file / crawl", () => {
    expect(
      createHttpTools({ root })
        .map((t) => t.name)
        .sort(),
    ).toEqual(["crawl", "download_file", "http_request"]);
  });
});

describe("SSRF guard (default-deny private hosts, no network)", () => {
  it("refuses private/loopback hosts across every tool", async () => {
    for (const url of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      expect(await call("http_request", { url, method: "GET" })).toMatch(
        /private\/loopback/,
      );
      expect(await call("download_file", { url, path: "a" })).toMatch(
        /private\/loopback/,
      );
      expect(await call("crawl", { url })).toMatch(
        /no pages|private\/loopback/,
      );
    }
  });
});

describe("http_request", () => {
  it("returns status, content-type, and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"ok":true}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const r = await call("http_request", {
      url: "https://api.example.com/x",
      method: "GET",
    });
    expect(r).toMatch(/HTTP 200/);
    expect(r).toMatch(/content-type: application\/json/);
    expect(r).toMatch(/"ok":true/);
  });
});

describe("download_file", () => {
  it("saves bytes to the scoped dir and reports size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    );
    const r = await call("download_file", {
      url: "https://example.com/f.bin",
      path: "out/f.bin",
    });
    expect(r).toMatch(/Saved 4 bytes to out\/f\.bin/);
    expect(await fsp.readFile(join(root, "out", "f.bin"))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it("rejects a traversal path before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await call("download_file", {
      url: "https://example.com/f",
      path: "../escape",
    });
    expect(r).toMatch(/Error:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("crawl", () => {
  it("follows same-origin links up to the page cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/page2")) {
          return new Response(
            "<html><title>Two</title><body>second</body></html>",
            {
              status: 200,
              headers: { "content-type": "text/html" },
            },
          );
        }
        return new Response(
          '<html><title>One</title><body><a href="/page2">next</a><a href="https://other.com/x">offsite</a></body></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }),
    );
    const r = await call("crawl", {
      url: "https://site.com/",
      max_pages: 5,
      max_depth: 1,
    });
    expect(r).toMatch(/## One/);
    expect(r).toMatch(/## Two/); // followed the same-origin link
    // The off-site link may appear as rendered link text, but must not be
    // CRAWLED — i.e. no page section sourced from other.com.
    expect(r).not.toMatch(/<https:\/\/other\.com/);
  });
});
