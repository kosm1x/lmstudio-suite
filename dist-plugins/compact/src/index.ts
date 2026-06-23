// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-compact. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/time/time.ts
function hostTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// packages/core/src/schedule/schedule.ts
var CRON_FIELDS_5 = [
  [0, 59],
  // minute
  [0, 23],
  // hour
  [1, 31],
  // day of month
  [1, 12],
  // month
  [0, 7]
  // day of week (0 and 7 = Sunday)
];
var CRON_FIELDS_6 = [
  [0, 59],
  // second
  ...CRON_FIELDS_5
];

// packages/core/src/compact/compact.ts
function parseCompactTrigger(text, trigger) {
  const trig = (trigger ?? "").trim();
  const body = (text ?? "").trim();
  if (!trig || !body) return { matched: false, note: "" };
  for (const candidate of [body, ...body.split(/\r?\n/)]) {
    const line = candidate.trim();
    if (line === trig) return { matched: true, note: "" };
    if (line.startsWith(trig) && /\s/.test(line.charAt(trig.length))) {
      return { matched: true, note: line.slice(trig.length).trim() };
    }
  }
  return { matched: false, note: "" };
}
var ROLE_LABEL = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool"
};
function serializeTranscript(messages, opts = {}) {
  const lines = ["# Conversation export"];
  if (opts.generatedAt) lines.push("", `_Exported ${opts.generatedAt}._`);
  if (opts.note) lines.push("", `**Note:** ${opts.note.replace(/\s+/g, " ")}`);
  lines.push(
    "",
    `_${messages.length} message${messages.length === 1 ? "" : "s"}._`
  );
  if (opts.systemPrompt && opts.systemPrompt.trim()) {
    lines.push("", "## System prompt", "", quote(opts.systemPrompt));
  }
  lines.push("", "## Transcript");
  messages.forEach((m, i) => {
    const body = m.text.trim() ? quote(m.text) : "_(no text)_";
    lines.push("", `### ${i + 1}. ${ROLE_LABEL[m.role] ?? m.role}`, "", body);
  });
  return lines.join("\n") + "\n";
}
function quote(text) {
  return text.replace(/\r\n/g, "\n").split("\n").map((l) => l ? `> ${l}` : ">").join("\n");
}
function buildSummaryInstruction(transcript) {
  const fenced = transcript.trim().replace(/<<<TRANSCRIPT|TRANSCRIPT>>>/g, "[\u2026]");
  return [
    "You are compacting a conversation so it can continue in a fresh chat with",
    "less context. Read the transcript between the markers and write a concise",
    "hand-off summary (a few short paragraphs or bullet points) capturing:",
    "the goal, key decisions and their reasons, the current state, and the",
    "immediate next step. Write only the summary \u2014 no preamble, no markers.",
    "",
    "<<<TRANSCRIPT",
    fenced,
    "TRANSCRIPT>>>"
  ].join("\n");
}
function plainTranscript(messages) {
  return messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
}
function chunkTranscript(messages, maxChars) {
  const budget = Math.max(1, Math.floor(maxChars));
  const chunks = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const m of messages) {
    const block = `${m.role}: ${m.text}`;
    if (block.length > budget) {
      flush();
      for (let i = 0; i < block.length; i += budget) {
        chunks.push(block.slice(i, i + budget));
      }
      continue;
    }
    const candidate = current ? `${current}

${block}` : block;
    if (candidate.length > budget) {
      flush();
      current = block;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}
function buildChunkSummaryInstruction(chunk, index, total) {
  const fenced = chunk.trim().replace(/<<<TRANSCRIPT|TRANSCRIPT>>>/g, "[\u2026]");
  return [
    "You are compacting a long conversation in parts so it can continue in a",
    `fresh chat. This is part ${index} of ${total}. Summarize THIS part into`,
    "concise notes: the goal, key decisions and their reasons, the state, and any",
    "open threads. Keep names, numbers, and specifics. Write only the notes \u2014 no",
    "preamble, no markers.",
    "",
    "<<<TRANSCRIPT",
    fenced,
    "TRANSCRIPT>>>"
  ].join("\n");
}
function buildReduceInstruction(partialNotes) {
  const fenced = partialNotes.trim().replace(/<<<NOTES|NOTES>>>/g, "[\u2026]");
  return [
    "Below are ordered notes summarizing consecutive parts of one conversation.",
    "Merge them into a single concise hand-off summary (a few short paragraphs or",
    "bullet points) capturing: the goal, key decisions and their reasons, the",
    "current state, and the immediate next step. Remove redundancy; keep the",
    "chronological thread. Write only the summary \u2014 no preamble, no markers.",
    "",
    "<<<NOTES",
    fenced,
    "NOTES>>>"
  ].join("\n");
}
async function summarizeTranscript(messages, deps) {
  const { summarize, countTokens, budgetTokens } = deps;
  const plain = plainTranscript(messages);
  if (await countTokens(buildSummaryInstruction(plain)) <= budgetTokens) {
    return (await summarize(buildSummaryInstruction(plain))).trim();
  }
  const charsPerToken = plain.length / Math.max(1, await countTokens(plain));
  const chunkWrapperTokens = await countTokens(
    buildChunkSummaryInstruction("", 1, 9)
  );
  const chunkBudget = Math.max(1, budgetTokens - chunkWrapperTokens);
  const maxChars = Math.max(1, Math.floor(chunkBudget * charsPerToken));
  const chunks = chunkTranscript(messages, maxChars);
  const partials = [];
  for (const [i, chunk] of chunks.entries()) {
    const note = (await summarize(buildChunkSummaryInstruction(chunk, i + 1, chunks.length))).trim();
    if (note) partials.push(note);
  }
  if (partials.length <= 1) return partials[0] ?? "";
  let combined = partials.join("\n\n");
  const reduceWrapperTokens = await countTokens(buildReduceInstruction(""));
  const reduceBudget = Math.max(1, budgetTokens - reduceWrapperTokens);
  const combinedTokens = await countTokens(combined);
  if (combinedTokens > reduceBudget) {
    const ratio = combined.length / Math.max(1, combinedTokens);
    combined = combined.slice(0, Math.max(1, Math.floor(reduceBudget * ratio)));
  }
  return (await summarize(buildReduceInstruction(combined))).trim();
}
function stripReasoning(text) {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").replace(/<\/?think\b[^>]*>/gi, "").trim();
}
function compactStamp(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}-${hour}${get("minute")}`;
}
function compactFilenames(stamp) {
  return { dump: `compact-${stamp}.md`, seed: `compact-${stamp}.seed.md` };
}

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/http-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool3 } from "@lmstudio/sdk";
import { z as z3 } from "zod";

// packages/core/src/tools/map-tools.ts
import { tool as tool4 } from "@lmstudio/sdk";
import { z as z4 } from "zod";

// packages/core/src/tools/data-tools.ts
import { tool as tool5 } from "@lmstudio/sdk";
import { z as z5 } from "zod";

// packages/core/src/tools/memory-tools.ts
import { tool as tool6 } from "@lmstudio/sdk";
import { z as z6 } from "zod";

// packages/core/src/tools/time-tools.ts
import { tool as tool7 } from "@lmstudio/sdk";
import { z as z7 } from "zod";

// packages/core/src/tools/schedule-tools.ts
import { tool as tool8 } from "@lmstudio/sdk";
import { z as z8 } from "zod";

// packages/plugin-compact/src/index.ts
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// packages/plugin-compact/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var globalConfigSchematics = createConfigSchematics().field(
  "trigger",
  "string",
  {
    displayName: "Compact trigger",
    hint: "Type this as a message (alone, or followed by a note) to export the conversation. Must be the start of the message.",
    placeholder: "/compact"
  },
  "/compact"
).field(
  "dumpDir",
  "string",
  {
    displayName: "Export directory",
    hint: "Folder for the exported transcript + seed files. Leave blank to use the plugin's per-prediction working directory.",
    placeholder: "/Users/me/lmstudio-compacts"
  },
  ""
).field(
  "timezone",
  "string",
  {
    displayName: "Timezone",
    hint: "IANA timezone for the export filename timestamp (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
    placeholder: "America/Mexico_City"
  },
  ""
).build();
var chatConfigSchematics = createConfigSchematics().field(
  "enabled",
  "boolean",
  {
    displayName: "Enable /compact",
    hint: "Watch for the trigger word and export the conversation when it appears. On by default."
  },
  true
).field(
  "summarize",
  "boolean",
  {
    displayName: "Write a seed summary",
    hint: "Also ask the current model to summarize the conversation into a paste-ready seed for a fresh chat. One extra model call per /compact. On by default."
  },
  true
).field(
  "maxSummaryTokens",
  "numeric",
  {
    displayName: "Max tokens per summary call",
    hint: "Budget for each summarization model-call. MUST be below your model's loaded context length \u2014 LM Studio's API reports the model maximum, not the loaded window, so this can't be detected automatically. A long conversation is summarized in chunks of this size, then merged. Lower = more, smaller calls (safe, slower); raise it toward your context length for fewer, faster calls. Default 4000 fits virtually any model.",
    int: true,
    min: 1e3,
    max: 131072
  },
  4e3
).build();

// packages/plugin-compact/src/index.ts
function resolveTimezone(raw) {
  return (raw ?? "").trim() || hostTimezone();
}
function expandHome(p) {
  const t = (p ?? "").trim();
  if (!t) return "";
  const expanded = t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
}
async function resolveExportDir(configured, ctl) {
  const dir = expandHome(configured);
  if (dir) return dir;
  try {
    const wd = ctl.getWorkingDirectory();
    if (wd) return wd;
  } catch {
  }
  return join(tmpdir(), "lmstudio-compacts");
}
function humanStamp(now, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(now);
}
async function preprocess(ctl, userMessage) {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("enabled")) return userMessage;
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const trigger = (global.get("trigger") ?? "").trim() || "/compact";
  const { matched, note } = parseCompactTrigger(text, trigger);
  console.log(
    `[compact] trigger=${JSON.stringify(trigger)} matched=${matched} received=${JSON.stringify(text.slice(0, 160))}`
  );
  if (!matched) return userMessage;
  try {
    const history = await ctl.pullHistory();
    const messages = history.getMessagesArray().map((m) => ({ role: m.getRole(), text: m.getText() }));
    if (messages.length === 0) {
      return "[compact] Nothing to export yet \u2014 this conversation is empty.";
    }
    const now = /* @__PURE__ */ new Date();
    const tz = resolveTimezone(global.get("timezone"));
    const { dump, seed } = compactFilenames(compactStamp(now, tz));
    const dir = await resolveExportDir(global.get("dumpDir"), ctl);
    console.log(`[compact] export dir=${JSON.stringify(dir)}`);
    await mkdir(dir, { recursive: true });
    const transcriptMd = serializeTranscript(messages, {
      systemPrompt: history.getSystemPrompt(),
      generatedAt: humanStamp(now, tz),
      note
    });
    const dumpPath = join(dir, dump);
    await writeFile(dumpPath, transcriptMd, "utf8");
    console.log(`[compact] wrote ${dumpPath}`);
    const lines = [
      "[compact] Exported this conversation.",
      "",
      `- Transcript: ${dumpPath}`
    ];
    let summary = null;
    let summaryError = null;
    if (chat.get("summarize")) {
      try {
        const source = await ctl.tokenSource();
        const budgetTokens = chat.get("maxSummaryTokens");
        const summarize = async (instruction) => {
          const result = await source.respond(instruction);
          const raw = result.nonReasoningContent.trim() ? result.nonReasoningContent : result.content;
          return stripReasoning(raw);
        };
        const countTokens = "countTokens" in source ? (text2) => source.countTokens(text2) : async (text2) => Math.ceil(text2.length / 4);
        summary = await summarizeTranscript(messages, {
          summarize,
          countTokens,
          budgetTokens
        }) || null;
      } catch (err) {
        summaryError = errText(err);
        ctl.debug(`[compact] summary failed: ${errText(err)}`);
      }
      if (summary) {
        const seedPath = join(dir, seed);
        await writeFile(seedPath, `# Resume seed

${summary}
`, "utf8");
        lines.push(
          `- Seed: ${seedPath}`,
          "",
          "Summary for the next chat:",
          "",
          summary
        );
      } else if (summaryError) {
        lines.push(
          "",
          `_(Seed summary failed: ${summaryError} \u2014 the full transcript above is still saved.)_`
        );
      } else {
        lines.push(
          "",
          "_(Seed summary skipped \u2014 the model returned nothing.)_"
        );
      }
    }
    lines.push(
      "",
      "Open a New Chat to continue with compacted context" + (summary ? ", pasting the summary above." : "."),
      "_(This plugin exports the conversation but cannot clear the current chat \u2014 that's the New Chat button.)_"
    );
    return lines.join("\n");
  } catch (err) {
    console.log(`[compact] export failed: ${errText(err)}`);
    return `[compact] Export failed: ${errText(err)}`;
  }
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withPromptPreprocessor(preprocess);
}
export {
  main,
  preprocess
};
