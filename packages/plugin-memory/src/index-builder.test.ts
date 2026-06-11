import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbedFn } from "@lmstudio-suite/core";
import { getOrBuildStore } from "./index-builder";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mem-build-"));
  await writeFile(join(dir, "a.md"), "The capital of France is Paris.");
  await writeFile(join(dir, "b.txt"), "Water boils at 100 degrees Celsius.");
  await writeFile(join(dir, "ignore.png"), "not text");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("getOrBuildStore", () => {
  it("indexes text files (ignoring non-text) and embeds each chunk once", async () => {
    let calls = 0;
    const embed: EmbedFn = async (texts) => {
      calls += 1;
      return texts.map((t) => [t.length]);
    };
    // Unique model name per run so we never collide with a previous run's cache.
    const model = `m-${dir}`;

    const store = await getOrBuildStore(dir, model, embed);
    expect(store.size).toBe(2); // a.md + b.txt, png skipped
    expect(calls).toBe(1); // one batched embed call

    // Second call with the same (dir, model) hits the cache: no new embed calls.
    const again = await getOrBuildStore(dir, model, embed);
    expect(again.size).toBe(2);
    expect(calls).toBe(1);
  });
});
