/**
 * memory — an LM Studio Prompt Preprocessor plugin.
 *
 * On each user message it retrieves the most relevant snippets from a configured
 * knowledge directory (embedded with an LM Studio embedding model) and prepends
 * them as context. Any failure passes the message through unchanged — retrieval
 * must never block the user.
 */
import type {
  ChatMessage,
  PluginContext,
  PromptPreprocessorController,
  Tool,
  ToolsProviderController,
} from "@lmstudio/sdk";
import { createMemoryTools, type EmbedFn } from "@lmstudio-suite/core";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chatConfigSchematics, globalConfigSchematics } from "./config";
import { buildContextBlock } from "./context";
import { getOrBuildStore } from "./index-builder";

/** Expand a leading ~ and resolve; "" stays "". */
function expandHome(p: string): string {
  const t = p.trim();
  if (!t) return "";
  const expanded =
    t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
}

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const query = userMessage.getText().trim();
  if (!query) return userMessage;

  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  // Expand ~ so retrieval reads the SAME directory the write tools write to.
  const knowledgeDir = expandHome(global.get("knowledgeDir"));
  const embeddingModel = global.get("embeddingModel").trim();
  if (!knowledgeDir || !embeddingModel) return userMessage; // not configured

  try {
    const handle = await ctl.client.embedding.model(embeddingModel);
    const embed: EmbedFn = async (texts) =>
      (await handle.embed(texts)).map((r) => r.embedding);

    const store = await getOrBuildStore(knowledgeDir, embeddingModel, embed);
    if (store.size === 0) return userMessage;

    const [queryVector] = await embed([query]);
    if (!queryVector) return userMessage;

    const hits = store.query(
      queryVector,
      chat.get("topK"),
      chat.get("minScore"),
    );
    if (hits.length === 0) return userMessage;

    return `${buildContextBlock(hits, chat.get("maxChars"))}\n\n${query}`;
  } catch {
    return userMessage; // never block on a retrieval error
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir"));
  // Inert until a knowledge directory is configured and writing is enabled.
  if (!dir || !chat.get("enableWrite")) return [];
  return createMemoryTools({ root: dir });
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withPromptPreprocessor(preprocess)
    .withToolsProvider(toolsProvider);
}
