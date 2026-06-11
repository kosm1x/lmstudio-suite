/** Tools provider for local-tools — wires plugin config into core's fs/shell tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { createFsTools, createShellTool } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = ctl.getWorkingDirectory();

  const tools = createFsTools({ root });
  if (chat.get("enableShell")) {
    tools.push(
      createShellTool({ cwd: root, timeoutMs: chat.get("commandTimeoutMs") }),
    );
  }
  return tools;
}
