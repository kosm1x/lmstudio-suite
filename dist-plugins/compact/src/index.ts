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
  const body = text.trim();
  const trig = trigger.trim();
  if (!trig || !body) return { matched: false, note: "" };
  if (body === trig) return { matched: true, note: "" };
  if (body.startsWith(trig) && /\s/.test(body.charAt(trig.length))) {
    return { matched: true, note: body.slice(trig.length).trim() };
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
import { homedir } from "node:os";
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
).build();

// packages/plugin-compact/src/index.ts
function resolveTimezone(raw) {
  return raw.trim() || hostTimezone();
}
function expandHome(p) {
  const t = p.trim();
  if (!t) return "";
  const expanded = t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
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
  const { matched, note } = parseCompactTrigger(text, global.get("trigger"));
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
    const dir = expandHome(global.get("dumpDir")) || ctl.getWorkingDirectory();
    await mkdir(dir, { recursive: true });
    const transcriptMd = serializeTranscript(messages, {
      systemPrompt: history.getSystemPrompt(),
      generatedAt: humanStamp(now, tz),
      note
    });
    const dumpPath = join(dir, dump);
    await writeFile(dumpPath, transcriptMd, "utf8");
    const lines = [
      "[compact] Exported this conversation.",
      "",
      `- Transcript: ${dumpPath}`
    ];
    let summary = null;
    if (chat.get("summarize")) {
      const plain = messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
      try {
        const source = await ctl.tokenSource();
        const result = await source.respond(buildSummaryInstruction(plain));
        const raw = result.nonReasoningContent.trim() ? result.nonReasoningContent : result.content;
        summary = stripReasoning(raw) || null;
      } catch (err) {
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
