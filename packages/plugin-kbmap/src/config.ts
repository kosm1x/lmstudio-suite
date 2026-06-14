/** Config for the kb-map plugin: global (where the KB is) + per-chat (behavior). */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "knowledgeDir",
    "string",
    {
      displayName: "Knowledge directory",
      hint: "Absolute path to the folder of notes/memories to map (.md/.txt). Supports a leading ~. Leave blank to disable.",
      placeholder: "~/notes",
    },
    "",
  )
  .field(
    "warmFolders",
    "stringArray",
    {
      displayName: "Warm (archived) folders",
      hint: "Top-level folders kept out of the always-on map and reached only via search_map. Good for large archives.",
    },
    ["archive"],
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "injectMap",
    "boolean",
    {
      displayName: "Inject the map each turn",
      hint: "Prepend the knowledge-base map to your message so the model always knows what exists. Turn off to rely only on the map_overview tool.",
    },
    true,
  )
  .field(
    "mapMaxChars",
    "numeric",
    {
      displayName: "Max map characters",
      hint: "Budget for the injected/overview map. Large knowledge bases roll overflow into per-folder summaries reachable via search_map.",
      int: true,
      min: 500,
      max: 20_000,
    },
    4_000,
  )
  .field(
    "enableWrite",
    "boolean",
    {
      displayName: "Enable write_node",
      hint: "Let the model create or update entries in the knowledge base. Off by default.",
      warning:
        "write_node writes files inside your knowledge directory with your user account's privileges. Only enable for trusted models/tasks.",
    },
    false,
  )
  .build();
