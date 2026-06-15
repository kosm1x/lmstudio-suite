import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolsProviderController } from "@lmstudio/sdk";
import { toolsProvider } from "./tools";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "data-tools-plugin-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeController(workingDir: string): ToolsProviderController {
  const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });
  return {
    getPluginConfig: () => cfg({ workingDir }),
    getWorkingDirectory: () => dir,
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

describe("data-tools toolsProvider", () => {
  it("exposes the data toolset, scoped to the configured dir", async () => {
    const tools = (await toolsProvider(fakeController(dir))) as Array<{
      name: string;
    }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "calculator",
      "parse_json",
      "query_sqlite",
      "read_csv",
    ]);
  });

  it("still loads when no working directory is attached", async () => {
    const noWd = {
      getPluginConfig: () => ({ get: () => "" }),
      getWorkingDirectory: () => {
        throw new Error("not attached to a working directory");
      },
      abortSignal: new AbortController().signal,
    } as unknown as ToolsProviderController;
    const tools = (await toolsProvider(noWd)) as Array<{ name: string }>;
    expect(tools).toHaveLength(4);
  });
});
