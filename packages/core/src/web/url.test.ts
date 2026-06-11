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

  it("flags IPv6 loopback/link-local/unique-local and 0.0.0.0 (regression)", () => {
    // IPv6 arrives bracketed from URL.hostname
    expect(isPrivateHost(new URL("http://[::1]/").hostname)).toBe(true);
    for (const h of ["0.0.0.0", "fe80::1", "fc00::1", "fd12::3"]) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });

  it("blocks IPv4-mapped/compat IPv6 as URL.hostname compresses them (regression)", () => {
    const host = (u: string) => new URL(u).hostname; // e.g. "[::ffff:7f00:1]"
    for (const u of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/", // cloud metadata
      "http://[::ffff:10.0.0.1]/",
      "http://[::127.0.0.1]/",
    ]) {
      expect(isPrivateHost(host(u))).toBe(true);
    }
    // a public address in mapped form must still be allowed (no over-blocking)
    expect(isPrivateHost(host("http://[::ffff:8.8.8.8]/"))).toBe(false);
  });

  it("blocks trailing-dot FQDNs and numeric IPv4 forms via URL.hostname (regression)", () => {
    const host = (u: string) => new URL(u).hostname;
    for (const u of [
      "http://localhost./",
      "http://foo.localhost./",
      "http://2130706433/", // decimal 127.0.0.1
      "http://0x7f000001/", // hex
      "http://127.1/", // short form
    ]) {
      expect(isPrivateHost(host(u))).toBe(true);
    }
  });

  it("blocks CGNAT / benchmarking / IETF ranges and respects their boundaries", () => {
    for (const h of [
      "100.64.0.1",
      "100.127.255.1",
      "198.18.0.1",
      "198.19.0.1",
      "192.0.0.1",
    ]) {
      expect(isPrivateHost(h)).toBe(true);
    }
    // just-outside addresses stay public
    for (const h of ["100.63.0.1", "100.128.0.1", "198.20.0.1", "192.0.2.1"]) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});
