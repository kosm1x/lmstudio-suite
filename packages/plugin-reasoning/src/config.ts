/** Per-chat config for the reasoning preprocessor. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "cotMode",
    "select",
    {
      displayName: "Reasoning mode",
      hint: "How much step-by-step scaffolding to add to each user message.",
      options: [
        { value: "off", displayName: "Off" },
        { value: "concise", displayName: "Concise (think, then answer)" },
        {
          value: "full",
          displayName: "Full (explicit reasoning + 'Final answer:')",
        },
      ],
    },
    "concise",
  )
  .build();
