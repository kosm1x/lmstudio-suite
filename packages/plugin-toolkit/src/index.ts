/**
 * toolkit — an LM Studio Tools Provider meta-plugin.
 *
 * One install exposes the whole suite as tool groups you toggle per chat
 * (web / http / filesystem / shell / data / memory / kb-map), all scoped to a
 * single working directory. It composes the same `core/tools` builders the
 * individual plugins use — no duplicated implementations.
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
