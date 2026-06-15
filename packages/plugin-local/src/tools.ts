/** Tools provider for local-tools — wires plugin config into core's fs/shell tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFsTools, createShellTool } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

/**
 * The directory the file/shell tools are scoped to, in priority order:
 *   1. the "Working directory" configured for the chat (your project folder);
 *   2. LM Studio's auto per-chat working directory, if attached;
 *   3. a temp sandbox, so the tools still load + work in a plain chat.
 *
 * Step 2 throws ("not attached to a working directory") when no folder is
 * attached, so it must be guarded.
 */
async function resolveRoot(
  ctl: ToolsProviderController,
  configuredDir: string,
): Promise<string> {
  const dir = (configuredDir ?? "").trim();
  if (dir) {
    const expanded =
      dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
    return resolve(expanded);
  }
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
  const root = await resolveRoot(ctl, chat.get("workingDir"));

  const tools = createFsTools({ root });
  if (chat.get("enableShell")) {
    tools.push(
      createShellTool({
        cwd: root,
        timeoutMs: chat.get("commandTimeoutMs"),
        policy: {
          allow: chat.get("shellAllow"),
          deny: chat.get("shellDeny"),
        },
      }),
    );
  }
  return tools;
}
