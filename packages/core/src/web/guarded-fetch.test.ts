import { describe, it, expect, afterEach, vi } from "vitest";
import { guardedFetch } from "./guarded-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("guardedFetch", () => {
  it("re-validates each redirect hop and blocks a 30x into a private host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/" },
          }),
      ),
    );
    await expect(guardedFetch("https://public.example.com/")).rejects.toThrow(
      /private\/loopback/,
    );
  });

  it("follows public redirects and returns the final response + url", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        return n === 1
          ? new Response(null, {
              status: 301,
              headers: { location: "https://b.example.com/" },
            })
          : new Response("ok", { status: 200 });
      }),
    );
    const { response, finalUrl } = await guardedFetch("https://a.example.com/");
    expect(response.status).toBe(200);
    expect(finalUrl).toBe("https://b.example.com/");
  });

  it("caps the number of redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://loop.example.com/next" },
          }),
      ),
    );
    await expect(
      guardedFetch("https://loop.example.com/", {}, { maxRedirects: 3 }),
    ).rejects.toThrow(/Too many redirects/);
  });

  it("rejects non-http protocols", async () => {
    await expect(guardedFetch("file:///etc/passwd")).rejects.toThrow(
      /http\/https/,
    );
  });
});
