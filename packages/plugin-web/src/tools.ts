/** Tools provider for web-tools — wires plugin config into core's web tools. */
import { type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { createWebTools, type SearchProviderName } from "@lmstudio-suite/core";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);

  return createWebTools({
    search: {
      provider: global.get("searchProvider") as SearchProviderName,
      apiKey: global.get("searchApiKey") || undefined,
      searxngUrl: global.get("searxngUrl") || undefined,
    },
    maxResults: chat.get("maxResults"),
    fetchMaxChars: chat.get("fetchMaxChars"),
  });
}
