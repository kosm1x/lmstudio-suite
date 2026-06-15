/** Tools provider for the toolkit meta-plugin — composes core builders by group. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createWebTools,
  createHttpTools,
  createFsTools,
  createShellTool,
  createDataTools,
  createMemoryTools,
  createMapTools,
  scanKbDir,
  type KbGraph,
  type SearchProviderName,
} from "@lmstudio-suite/core";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

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
    const fallback = join(tmpdir(), "lmstudio-toolkit");
    await mkdir(fallback, { recursive: true }).catch(() => {});
    return fallback;
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = await resolveRoot(ctl, global.get("workingDir"));
  const allowPrivateHosts = global.get("allowPrivateHosts");

  const tools: Tool[] = [];

  if (chat.get("enableWeb")) {
    tools.push(
      ...createWebTools({
        search: {
          provider: global.get("searchProvider") as SearchProviderName,
          apiKey: global.get("searchApiKey") || undefined,
          searxngUrl: global.get("searxngUrl") || undefined,
        },
        allowPrivateHosts,
      }),
    );
  }
  if (chat.get("enableHttp")) {
    tools.push(...createHttpTools({ root, allowPrivateHosts }));
  }
  if (chat.get("enableFs")) {
    tools.push(...createFsTools({ root }));
  }
  if (chat.get("enableShell")) {
    tools.push(createShellTool({ cwd: root }));
  }
  if (chat.get("enableData")) {
    tools.push(...createDataTools({ root }));
  }
  if (chat.get("enableMemory")) {
    tools.push(...createMemoryTools({ root }));
  }
  if (chat.get("enableKbMap")) {
    let graph: KbGraph | undefined;
    const loadGraph = async (): Promise<KbGraph> =>
      (graph ??= (await scanKbDir(root)).graph);
    tools.push(...createMapTools({ root, loadGraph }));
  }

  return tools;
}
