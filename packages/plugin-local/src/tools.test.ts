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

function fakeController(enableShell: boolean): ToolsProviderController {
  const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });
  return {
    getPluginConfig: () =>
      cfg({ enableShell, commandTimeoutMs: 30_000, workingDir: "" }),
    getWorkingDirectory: () => dir,
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

const names = (tools: Array<{ name: string }>) =>
  tools.map((t) => t.name).sort();

describe("local-tools toolsProvider", () => {
  it("exposes only filesystem tools when shell is disabled", async () => {
    const tools = (await toolsProvider(fakeController(false))) as Array<{
      name: string;
    }>;
    expect(names(tools)).toEqual(["list_dir", "read_file", "write_file"]);
  });

  it("adds run_shell when shell is enabled", async () => {
    const tools = (await toolsProvider(fakeController(true))) as Array<{
      name: string;
    }>;
    expect(names(tools)).toEqual([
      "list_dir",
      "read_file",
      "run_shell",
      "write_file",
    ]);
  });

  it("still loads tools when no working directory is attached (regression)", async () => {
    const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });
    const noWdController = {
      getPluginConfig: () =>
        cfg({ enableShell: false, commandTimeoutMs: 30_000, workingDir: "" }),
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
    expect(names(tools)).toEqual(["list_dir", "read_file", "write_file"]);
  });

  it("scopes tools to a configured workingDir without needing an attached folder", async () => {
    const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] });
    const controller = {
      getPluginConfig: () =>
        cfg({ enableShell: false, commandTimeoutMs: 30_000, workingDir: dir }),
      getWorkingDirectory: () => {
        throw new Error("not attached"); // configured dir should win, so this is never hit
      },
      abortSignal: new AbortController().signal,
    } as unknown as ToolsProviderController;

    const tools = (await toolsProvider(controller)) as Array<{ name: string }>;
    expect(names(tools)).toEqual(["list_dir", "read_file", "write_file"]);
  });
});
