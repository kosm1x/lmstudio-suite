import { describe, expect, it } from "vitest";
import { fetchPage } from "./fetch";

describe("fetchPage SSRF guard", () => {
  it("refuses private/loopback hosts by default (no network)", async () => {
    for (const url of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(fetchPage(url)).rejects.toThrow(/private\/loopback host/);
    }
  });

  it("rejects non-http protocols", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(
      /http\/https/,
    );
  });
});
