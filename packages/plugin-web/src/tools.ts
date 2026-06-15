/** Tools provider for web-tools — wires plugin config into core's web tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createWebTools,
  createHttpTools,
  type SearchProviderName,
} from "@lmstudio-suite/core";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

/** Resolve the download directory: configured dir (with ~), else a temp sandbox. */
async function resolveDownloadDir(configured: string): Promise<string> {
  const dir = (configured ?? "").trim();
  if (dir) {
    const expanded =
      dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
    return resolve(expanded);
  }
  const fallback = join(tmpdir(), "lmstudio-web-downloads");
  await mkdir(fallback, { recursive: true }).catch(() => {});
  return fallback;
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const allowPrivateHosts = global.get("allowPrivateHosts");

  const webTools = createWebTools({
    search: {
      provider: global.get("searchProvider") as SearchProviderName,
      apiKey: global.get("searchApiKey") || undefined,
      searxngUrl: global.get("searxngUrl") || undefined,
    },
    maxResults: chat.get("maxResults"),
    fetchMaxChars: chat.get("fetchMaxChars"),
    allowPrivateHosts,
  });

  const httpTools = createHttpTools({
    root: await resolveDownloadDir(chat.get("downloadDir")),
    allowPrivateHosts,
  });

  return [...webTools, ...httpTools];
}
