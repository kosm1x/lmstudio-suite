/**
 * time — an LM Studio plugin that gives a local model a sense of "now".
 *
 * Two complementary halves:
 *  - a Prompt Preprocessor that prepends one "Current date and time: …" line so
 *    the model never has to guess today's date (LLMs are reliably wrong about it);
 *  - a Tools Provider exposing deterministic date/time + timezone tools (now,
 *    time_until, add_duration, diff_dates, convert_timezone) so relative-date and
 *    timezone math is exact, not hallucinated.
 *
 * Both honour a configured default timezone, falling back to this machine's zone.
 * The preprocessor never blocks a message: any error passes it through unchanged.
 */
import type {
  ChatMessage,
  PluginContext,
  PromptPreprocessorController,
  Tool,
  ToolsProviderController,
} from "@lmstudio/sdk";
import {
  createTimeTools,
  hostTimezone,
  timeContextLine,
} from "@lmstudio-suite/core";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

/** Configured zone, or this machine's zone when left blank. */
function resolveTimezone(raw: string): string {
  const t = raw.trim();
  return t || hostTimezone();
}

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;

  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("injectDateTime")) return userMessage;

  try {
    const tz = resolveTimezone(
      ctl.getGlobalPluginConfig(globalConfigSchematics).get("timezone"),
    );
    return `${timeContextLine(new Date(), tz)}\n\n${text}`;
  } catch {
    return userMessage; // a bad timezone config must never block the user
  }
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("enableTools")) return [];
  const tz = resolveTimezone(
    ctl.getGlobalPluginConfig(globalConfigSchematics).get("timezone"),
  );
  return createTimeTools({ defaultTimezone: tz });
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withPromptPreprocessor(preprocess)
    .withToolsProvider(toolsProvider);
}
