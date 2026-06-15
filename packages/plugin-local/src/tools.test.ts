import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolsProviderController } from "@lmstudio/sdk";
import { toolsProvider } from "./tools";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "local-tools-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });

const baseConfig = (over: Record<string, unknown> = {}) => ({
  enableShell: false,
  commandTimeoutMs: 30_000,
  workingDir: "",
  shellAllow: [] as string[],
  shellDeny: [] as string[],
  ...over,
});

function fakeController(enableShell: boolean): ToolsProviderController {
  return {
    getPluginConfig: () => cfg(baseConfig({ enableShell })),
    getWorkingDirectory: () => dir,
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

const names = (tools: Array<{ name: string }>) =>
  tools.map((t) => t.name).sort();

/** The full filesystem toolset (sorted), shared by createFsTools consumers. */
const FS_TOOLS = [
  "delete_file",
  "edit_file",
  "glob",
  "list_dir",
  "make_dir",
  "move_file",
  "read_file",
  "search_files",
  "stat_path",
  "write_file",
];

describe("local-tools toolsProvider", () => {
  it("exposes only filesystem tools when shell is disabled", async () => {
    const tools = (await toolsProvider(fakeController(false))) as Array<{
      name: string;
    }>;
    expect(names(tools)).toEqual(FS_TOOLS);
  });

  it("adds run_shell when shell is enabled", async () => {
    const tools = (await toolsProvider(fakeController(true))) as Array<{
      name: string;
    }>;
    expect(names(tools)).toEqual([...FS_TOOLS, "run_shell"].sort());
  });

  it("still loads tools when no working directory is attached (regression)", async () => {
    const noWdController = {
      getPluginConfig: () => cfg(baseConfig()),
      getWorkingDirectory: () => {
        throw new Error(
          "This prediction process is not attached to a working directory.",
        );
      },
      abortSignal: new AbortController().signal,
    } as unknown as ToolsProviderController;

    const tools = (await toolsProvider(noWdController)) as Array<{
      name: string;
    }>;
    expect(names(tools)).toEqual(FS_TOOLS);
  });

  it("scopes tools to a configured workingDir without needing an attached folder", async () => {
    const controller = {
      getPluginConfig: () => cfg(baseConfig({ workingDir: dir })),
      getWorkingDirectory: () => {
        throw new Error("not attached"); // configured dir should win, so this is never hit
      },
      abortSignal: new AbortController().signal,
    } as unknown as ToolsProviderController;

    const tools = (await toolsProvider(controller)) as Array<{ name: string }>;
    expect(names(tools)).toEqual(FS_TOOLS);
  });
});
