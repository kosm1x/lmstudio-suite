/** Config for the time plugin: a default zone + two toggles. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "timezone",
    "string",
    {
      displayName: "Default timezone",
      hint: "IANA timezone the date/time injection and tools use by default (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
      placeholder: "America/Mexico_City",
    },
    "",
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "injectDateTime",
    "boolean",
    {
      displayName: "Inject current date/time",
      hint: "Prepend a 'Current date and time: …' line to each message so the model never guesses the date. On by default.",
    },
    true,
  )
  .field(
    "enableTools",
    "boolean",
    {
      displayName: "Expose date/time tools",
      hint: "Provide now, time_until, add_duration, diff_dates, convert_timezone. On by default.",
    },
    true,
  )
  .build();
