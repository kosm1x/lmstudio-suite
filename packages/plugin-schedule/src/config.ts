/** Config for the schedule plugin: where job specs live + a default timezone. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "scheduleDir",
    "string",
    {
      displayName: "Schedule directory",
      hint: "Absolute path where scheduled-task specs are stored (supports a leading ~). The scheduler daemon must read this SAME directory. Leave blank to disable.",
      placeholder: "~/.lmstudio-suite/schedules",
    },
    "",
  )
  .field(
    "timezone",
    "string",
    {
      displayName: "Default timezone",
      hint: "IANA timezone for cron schedules when none is given (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
      placeholder: "America/Mexico_City",
    },
    "",
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "enableTools",
    "boolean",
    {
      displayName: "Enable schedule tools",
      hint: "Expose schedule_task / list_schedules / cancel_schedule / update_schedule / run_schedule_now. Requires a Schedule directory above. On by default.",
    },
    true,
  )
  .build();
