/**
 * reasoning — an LM Studio Prompt Preprocessor plugin that adds chain-of-thought
 * scaffolding to the user's message, helping smaller local models reason before
 * answering. The amount of scaffolding is configurable per chat.
 *
 * Note: a preprocessor only shapes the *input*. Hard schema enforcement on the
 * *output* lives in @lmstudio-suite/core's generateStructured (used by SDK apps
 * such as the agent CLI), since that requires control over generation.
 */
import type {
  ChatMessage,
  PluginContext,
  PromptPreprocessorController,
} from "@lmstudio/sdk";
import { cotScaffold, type CotMode } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;

  const mode = ctl
    .getPluginConfig(chatConfigSchematics)
    .get("cotMode") as CotMode;
  if (mode === "off") return userMessage;

  return cotScaffold(text, mode);
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withPromptPreprocessor(preprocess);
}
