/** Tools provider for data-tools — wires plugin config into core's data tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDataTools } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

/**
 * The directory file inputs are read from, in priority order:
 *   1. the "Working directory" configured for the chat;
 *   2. LM Studio's auto per-chat working directory, if attached;
 *   3. a temp sandbox, so the tools still load in a plain chat.
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
    const fallback = join(tmpdir(), "lmstudio-data-tools");
    await mkdir(fallback, { recursive: true }).catch(() => {});
    return fallback;
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = await resolveRoot(ctl, chat.get("workingDir"));
  return createDataTools({ root });
}
