/**
 * compact — an LM Studio plugin that exports a conversation on a trigger word.
 *
 * Why a preprocessor (and not a tool): only a prompt preprocessor gets a
 * `ProcessingController`, which is the single place the SDK lets a plugin read
 * the conversation (`pullHistory()`). Tools get a bare `ToolsProviderController`
 * with no history access. And nothing in the SDK can *clear* the chat —
 * `pullHistory()` returns a copy, so "compact" here means **export + seed**, not
 * reset. Clearing is the host's New Chat button; this plugin hands the user a
 * paste-ready summary to carry across.
 *
 * On a message that starts with the trigger (default `/compact`):
 *  1. pull the prior history (the trigger message itself is excluded by the SDK);
 *  2. write the full transcript to a timestamped Markdown file;
 *  3. optionally ask the current model to summarize it into a `.seed.md`;
 *  4. replace the user's message with a status note pointing at both files.
 *
 * Any failure degrades gracefully: a model error still leaves the transcript on
 * disk, and a total failure returns an explanation instead of blocking the turn.
 */
import type {
  ChatMessage,
  PluginContext,
  PromptPreprocessorController,
} from "@lmstudio/sdk";
import {
  compactFilenames,
  compactStamp,
  hostTimezone,
  parseCompactTrigger,
  serializeTranscript,
  stripReasoning,
  summarizeTranscript,
  type TranscriptMessage,
} from "@lmstudio-suite/core";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

/** Configured zone, or this machine's zone when left blank. */
function resolveTimezone(raw: string): string {
  return raw.trim() || hostTimezone();
}

/** Expand a leading ~ and resolve; "" stays "" (matches sibling plugins). */
function expandHome(p: string): string {
  const t = p.trim();
  if (!t) return "";
  const expanded =
    t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
}

/** A readable wall-clock stamp for the export header, in the given zone. */
function humanStamp(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
}

export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;

  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("enabled")) return userMessage;

  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const { matched, note } = parseCompactTrigger(text, global.get("trigger"));
  if (!matched) return userMessage;

  try {
    const history = await ctl.pullHistory();
    const messages: TranscriptMessage[] = history
      .getMessagesArray()
      .map((m) => ({ role: m.getRole(), text: m.getText() }));

    if (messages.length === 0) {
      return "[compact] Nothing to export yet — this conversation is empty.";
    }

    const now = new Date();
    const tz = resolveTimezone(global.get("timezone"));
    const { dump, seed } = compactFilenames(compactStamp(now, tz));
    const dir = expandHome(global.get("dumpDir")) || ctl.getWorkingDirectory();
    await mkdir(dir, { recursive: true });

    const transcriptMd = serializeTranscript(messages, {
      systemPrompt: history.getSystemPrompt(),
      generatedAt: humanStamp(now, tz),
      note,
    });
    const dumpPath = join(dir, dump);
    await writeFile(dumpPath, transcriptMd, "utf8");

    const lines = [
      "[compact] Exported this conversation.",
      "",
      `- Transcript: ${dumpPath}`,
    ];

    let summary: string | null = null;
    let summaryError: string | null = null;
    if (chat.get("summarize")) {
      try {
        const source = await ctl.tokenSource();
        const budgetTokens = await summaryInputBudgetTokens(source);
        // One model call on an instruction → cleaned text. Prefer the SDK's
        // separated non-reasoning content; strip <think> either way so a
        // reasoning-only answer never lands raw in the seed.
        const summarize = async (instruction: string): Promise<string> => {
          const result = await source.respond(instruction);
          const raw = result.nonReasoningContent.trim()
            ? result.nonReasoningContent
            : result.content;
          return stripReasoning(raw);
        };
        // Map-reduce when the transcript would overflow the context, so a long
        // conversation (exactly when compaction matters) still summarizes.
        // Token counts use the model's tokenizer when available, else an estimate.
        const countTokens =
          "countTokens" in source
            ? (text: string) => source.countTokens(text)
            : async (text: string) => Math.ceil(text.length / 4);
        summary =
          (await summarizeTranscript(messages, {
            summarize,
            countTokens,
            budgetTokens,
          })) || null;
      } catch (err) {
        summaryError = errText(err);
        ctl.debug(`[compact] summary failed: ${errText(err)}`);
      }
      if (summary) {
        const seedPath = join(dir, seed);
        await writeFile(seedPath, `# Resume seed\n\n${summary}\n`, "utf8");
        lines.push(
          `- Seed: ${seedPath}`,
          "",
          "Summary for the next chat:",
          "",
          summary,
        );
      } else if (summaryError) {
        lines.push(
          "",
          `_(Seed summary failed: ${summaryError} — the full transcript above is still saved.)_`,
        );
      } else {
        lines.push(
          "",
          "_(Seed summary skipped — the model returned nothing.)_",
        );
      }
    }

    lines.push(
      "",
      "Open a New Chat to continue with compacted context" +
        (summary ? ", pasting the summary above." : "."),
      "_(This plugin exports the conversation but cannot clear the current chat — that's the New Chat button.)_",
    );
    return lines.join("\n");
  } catch (err) {
    return `[compact] Export failed: ${errText(err)}`;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Max input tokens for one summary call, with output headroom reserved.
 *
 * MUST be derived from the model's **loaded** context window. `getModelInfo()`
 * on a loaded handle reports the instance's `contextLength` (the loaded window);
 * `getContextLength()` can instead report the model's *maximum* (e.g. ~100k for
 * Llama 4), which — if used as the budget — lets a single summary call overflow
 * the much smaller loaded window. So prefer `getModelInfo()`, fall back to
 * `getContextLength()`, then a safe constant. Reserve ~30% for the instruction
 * overhead + the model's own summary output.
 */
async function summaryInputBudgetTokens(
  source: Awaited<ReturnType<PromptPreprocessorController["tokenSource"]>>,
): Promise<number> {
  let contextTokens = 0;
  try {
    if ("getModelInfo" in source) {
      const info = await source.getModelInfo();
      if (info && typeof info.contextLength === "number") {
        contextTokens = info.contextLength;
      }
    }
  } catch {
    /* fall through */
  }
  if (contextTokens <= 0 && "getContextLength" in source) {
    try {
      const c = await source.getContextLength();
      if (c > 0) contextTokens = c;
    } catch {
      /* fall through */
    }
  }
  if (contextTokens <= 0) return 4000; // safe default when nothing is reported
  return Math.max(512, Math.floor(contextTokens * 0.7));
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withPromptPreprocessor(preprocess);
}
