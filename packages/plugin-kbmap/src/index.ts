/**
 * kb-map — an LM Studio plugin that gives a local model "map memory" over a
 * directory of notes.
 *
 * Two chained hooks:
 *  - Prompt Preprocessor: prepends a compact, budgeted map of the knowledge base
 *    to each message, so the model always knows what exists (the priming that
 *    makes it actually reach for the tools).
 *  - Tools Provider: map_overview / search_map / read_node / follow_links, plus
 *    opt-in write_node, so the model navigates from the map into detail and
 *    walks the [[wikilink]] graph.
 *
 * The structural map needs no embedding model; it is the deterministic,
 * structure-aware complement to the semantic `memory` plugin. Any failure passes
 * the message through unchanged — retrieval must never block the user.
 */
import type {
  ChatMessage,
  PluginContext,
  PromptPreprocessorController,
  Tool,
  ToolsProviderController,
} from "@lmstudio/sdk";
import { createMapTools, renderDigest } from "@lmstudio-suite/core";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { chatConfigSchematics, globalConfigSchematics } from "./config";
import { getOrBuildKbGraph } from "./map-cache";

/** Expand a leading ~ and resolve to an absolute path; "" stays "". */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p ? resolve(p) : "";
}

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const query = userMessage.getText().trim();
  if (!query) return userMessage;

  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir").trim());
  if (!dir || !chat.get("injectMap")) return userMessage;

  try {
    const graph = await getOrBuildKbGraph(dir, global.get("warmFolders"));
    if (graph.size === 0) return userMessage;
    const digest = renderDigest(graph, {
      root: dir,
      maxChars: chat.get("mapMaxChars"),
    });
    return `${digest}\n\n${query}`;
  } catch {
    return userMessage; // never block on a map-build error
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir").trim());
  if (!dir) return []; // inert until a knowledge directory is configured

  const warmFolders = global.get("warmFolders");
  // Must be a single top-level folder name (the organizer matches it against a
  // node's top-level dir); a path or `..` would silently sort nothing.
  const rawIncoming = global.get("incomingFolder").trim();
  const incomingFolder =
    rawIncoming && !rawIncoming.includes("/") && !rawIncoming.includes("..")
      ? rawIncoming
      : "incoming";
  return createMapTools({
    root: dir,
    enableWrite: chat.get("enableWrite"),
    digestMaxChars: chat.get("mapMaxChars"),
    incomingFolder,
    loadGraph: () => getOrBuildKbGraph(dir, warmFolders),
  });
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withPromptPreprocessor(preprocess)
    .withToolsProvider(toolsProvider);
}
