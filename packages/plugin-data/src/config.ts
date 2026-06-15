/** Per-chat config for the data-tools plugin. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "workingDir",
    "string",
    {
      displayName: "Working directory",
      hint: "Absolute path the data tools read files from (CSV / JSON / .db). Supports a leading ~. Leave blank to use the chat's auto working directory, falling back to a temp sandbox.",
      placeholder: "~/data",
    },
    "",
  )
  .build();
