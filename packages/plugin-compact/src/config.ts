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
  .build();
