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
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

/** Configured zone, or this machine's zone when left blank/unset. */
function resolveTimezone(raw: string | undefined): string {
  return (raw ?? "").trim() || hostTimezone();
}

/** Expand a leading ~ and resolve; blank/unset stays "" (matches siblings). */
function expandHome(p: string | undefined): string {
  const t = (p ?? "").trim();
  if (!t) return "";
  const expanded =
    t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
}

/**
 * The directory to export into, in priority order:
 *   1. the configured "Export directory" (expanded);
 *   2. LM Studio's per-prediction working directory, if attached;
 *   3. a temp folder — so the transcript ALWAYS lands somewhere writable.
 * Step 2 throws when no folder is attached, so it must be guarded — otherwise a
 * blank Export directory makes the whole export fail and nothing is written.
 */
async function resolveExportDir(
  configured: string | undefined,
  ctl: PromptPreprocessorController,
): Promise<string> {
  const dir = expandHome(configured);
  if (dir) return dir;
  try {
    const wd = ctl.getWorkingDirectory();
    if (wd) return wd;
  } catch {
    /* not attached to a working directory */
  }
  return join(tmpdir(), "lmstudio-compacts");
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
  // Default the trigger when the global field is unset/blank. LM Studio does not
  // reliably materialize a global-config default, so global.get("trigger") can be
  // undefined; an unguarded .trim() on it would throw HERE (outside the try
  // below) and fail the whole preprocessor open — the model then receives the raw
  // "/compact" and no file is written. Defaulting keeps it working with no config.
  const trigger = (global.get("trigger") ?? "").trim() || "/compact";
  const { matched, note } = parseCompactTrigger(text, trigger);
  // Log what compact actually received — earlier preprocessors in the chain can
  // prepend content, so a typed "/compact" may not arrive at the start verbatim.
  console.log(
    `[compact] trigger=${JSON.stringify(trigger)} matched=${matched} received=${JSON.stringify(text.slice(0, 160))}`,
  );
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
    const dir = await resolveExportDir(global.get("dumpDir"), ctl);
    console.log(`[compact] export dir=${JSON.stringify(dir)}`);
    await mkdir(dir, { recursive: true });

    const transcriptMd = serializeTranscript(messages, {
      systemPrompt: history.getSystemPrompt(),
      generatedAt: humanStamp(now, tz),
      note,
    });
    const dumpPath = join(dir, dump);
    await writeFile(dumpPath, transcriptMd, "utf8");
    console.log(`[compact] wrote ${dumpPath}`);

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
        // The per-call token budget is configured, not probed: LM Studio's
        // getModelInfo()/getContextLength() report the model MAXIMUM, not the
        // loaded window, so an auto-budget over-sizes and overflows. The user
        // sets this to fit their loaded context; the default is safe anywhere.
        const budgetTokens = chat.get("maxSummaryTokens");
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
    console.log(`[compact] export failed: ${errText(err)}`);
    return `[compact] Export failed: ${errText(err)}`;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withPromptPreprocessor(preprocess);
}
