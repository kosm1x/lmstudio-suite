/**
 * data-tools — an LM Studio Tools Provider plugin for deterministic data + math.
 *
 * Gives a local model exact answers instead of mental arithmetic and
 * eyeballed data: a calculator, JSON and CSV readers, and read-only SQLite
 * queries. File inputs are scoped to the configured working directory.
 */
import type { PluginContext } from "@lmstudio/sdk";
import { chatConfigSchematics } from "./config";
import { toolsProvider } from "./tools";

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withToolsProvider(toolsProvider);
}
