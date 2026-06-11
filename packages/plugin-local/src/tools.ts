/** Tools provider for local-tools — wires plugin config into core's fs/shell tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsTools, createShellTool } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

/**
 * The directory the file/shell tools are scoped to. LM Studio's
 * `getWorkingDirectory()` throws when the chat has no folder attached, so fall
 * back to a temp sandbox — otherwise the whole tools list fails to load in a
 * plain chat. Attach a folder to the chat to operate on real files.
 */
async function resolveRoot(ctl: ToolsProviderController): Promise<string> {
  try {
    return ctl.getWorkingDirectory();
  } catch {
    const fallback = join(tmpdir(), "lmstudio-local-tools");
    await mkdir(fallback, { recursive: true }).catch(() => {});
    return fallback;
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = await resolveRoot(ctl);

  const tools = createFsTools({ root });
  if (chat.get("enableShell")) {
    tools.push(
      createShellTool({ cwd: root, timeoutMs: chat.get("commandTimeoutMs") }),
    );
  }
  return tools;
}
