import { describe, it, expect } from "vitest";
import { parseHttpUrl, isPrivateHost } from "./url";

describe("parseHttpUrl", () => {
  it("accepts http and https", () => {
    expect(parseHttpUrl("https://a.com/x").hostname).toBe("a.com");
    expect(parseHttpUrl("http://a.com").protocol).toBe("http:");
  });

  it("rejects non-http protocols", () => {
    expect(() => parseHttpUrl("file:///etc/passwd")).toThrow(/http\/https/);
    expect(() => parseHttpUrl("ftp://a.com")).toThrow(/http\/https/);
  });

  it("rejects malformed urls", () => {
    expect(() => parseHttpUrl("not a url")).toThrow(/Invalid URL/);
  });
});

describe("isPrivateHost", () => {
  it("flags loopback and private ranges", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.9.9",
      "::1",
    ]) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });

  it("allows public hosts", () => {
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1"]) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});
