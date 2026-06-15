import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolsProviderController } from "@lmstudio/sdk";
import { toolsProvider } from "./tools";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toolkit-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });

const GROUPS_OFF = {
  enableWeb: false,
  enableHttp: false,
  enableFs: false,
  enableShell: false,
  enableData: false,
  enableMemory: false,
  enableKbMap: false,
};

function controller(
  chatGroups: Record<string, unknown>,
): ToolsProviderController {
  return {
    getGlobalPluginConfig: () =>
      cfg({
        workingDir: dir,
        searchProvider: "duckduckgo",
        searchApiKey: "",
        searxngUrl: "",
        allowPrivateHosts: false,
      }),
    getPluginConfig: () => cfg({ ...GROUPS_OFF, ...chatGroups }),
    getWorkingDirectory: () => dir,
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

const names = async (groups: Record<string, unknown>) =>
  (await toolsProvider(controller(groups)))
    .map((t) => (t as { name: string }).name)
    .sort();

describe("toolkit toolsProvider", () => {
  it("returns nothing when every group is off", async () => {
    expect(await names({})).toEqual([]);
  });

  it("includes only the enabled groups", async () => {
    expect(await names({ enableData: true })).toEqual([
      "calculator",
      "parse_json",
      "query_sqlite",
      "read_csv",
    ]);
    expect(await names({ enableMemory: true })).toEqual([
      "forget",
      "recall",
      "remember",
    ]);
  });

  it("composes multiple groups", async () => {
    const ns = await names({ enableWeb: true, enableShell: true });
    expect(ns).toContain("web_search");
    expect(ns).toContain("fetch_url");
    expect(ns).toContain("run_shell");
  });

  it("filesystem group exposes the full fs toolset", async () => {
    const ns = await names({ enableFs: true });
    expect(ns).toContain("read_file");
    expect(ns).toContain("edit_file");
    expect(ns).toContain("search_files");
    expect(ns).toContain("delete_file");
  });
});
