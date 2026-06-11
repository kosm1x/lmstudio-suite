/**
 * web-tools — an LM Studio Tools Provider plugin.
 *
 * Entry point: LM Studio calls `main(context)` when the plugin loads. We attach
 * the config schematics and the tools provider to the plugin context.
 */
import type { PluginContext } from "@lmstudio/sdk";
import { chatConfigSchematics, globalConfigSchematics } from "./config";
import { toolsProvider } from "./tools";

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withToolsProvider(toolsProvider);
}
