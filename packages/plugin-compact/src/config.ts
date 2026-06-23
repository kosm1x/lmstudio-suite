/** Config for the compact plugin: trigger word, output location, and toggles. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "trigger",
    "string",
    {
      displayName: "Compact trigger",
      hint: "Type this as a message (alone, or followed by a note) to export the conversation. Must be the start of the message.",
      placeholder: "/compact",
    },
    "/compact",
  )
  .field(
    "dumpDir",
    "string",
    {
      displayName: "Export directory",
      hint: "Folder for the exported transcript + seed files. Leave blank to use the plugin's per-prediction working directory.",
      placeholder: "/Users/me/lmstudio-compacts",
    },
    "",
  )
  .field(
    "timezone",
    "string",
    {
      displayName: "Timezone",
      hint: "IANA timezone for the export filename timestamp (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
      placeholder: "America/Mexico_City",
    },
    "",
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "enabled",
    "boolean",
    {
      displayName: "Enable /compact",
      hint: "Watch for the trigger word and export the conversation when it appears. On by default.",
    },
    true,
  )
  .field(
    "summarize",
    "boolean",
    {
      displayName: "Write a seed summary",
      hint: "Also ask the current model to summarize the conversation into a paste-ready seed for a fresh chat. One extra model call per /compact. On by default.",
    },
    true,
  )
  .field(
    "maxSummaryTokens",
    "numeric",
    {
      displayName: "Max tokens per summary call",
      hint: "Budget for each summarization model-call. MUST be below your model's loaded context length — LM Studio's API reports the model maximum, not the loaded window, so this can't be detected automatically. A long conversation is summarized in chunks of this size, then merged. Lower = more, smaller calls (safe, slower); raise it toward your context length for fewer, faster calls. Default 4000 fits virtually any model.",
      int: true,
      min: 1000,
      max: 131072,
    },
    4000,
  )
  .field(
    "summaryPrompt",
    "string",
    {
      displayName: "Summary instructions",
      hint: "What the seed should be. Leave blank for the built-in agent hand-off briefing (recap, characters, decisions + why, where you left off — written as prose for the next agent/writer). Override to tailor it, e.g. 'Recap the story, characters, key choices, and exactly where we left off, as a briefing for the writer who picks this up.' The conversation is appended automatically; ask for prose, no reasoning.",
      placeholder: "Blank = built-in agent hand-off briefing.",
    },
    "",
  )
  .field(
    "maxSummaryOutputTokens",
    "numeric",
    {
      displayName: "Summary length cap (tokens)",
      hint: "Caps how much the model generates per summary call — bounds seed length and speeds it up. NOTE: this counts reasoning tokens too, so if your model 'thinks' heavily and seeds come out cut off, raise it (or tell it not to reason). Default 1024.",
      int: true,
      min: 256,
      max: 8192,
    },
    1024,
  )
  .build();
