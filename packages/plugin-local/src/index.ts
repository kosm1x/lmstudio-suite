/**
 * local-tools — an LM Studio Tools Provider plugin for filesystem + shell access,
 * scoped to the prediction's working directory.
 */
import type { PluginContext } from "@lmstudio/sdk";
import { chatConfigSchematics } from "./config";
import { toolsProvider } from "./tools";

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withToolsProvider(toolsProvider);
}
