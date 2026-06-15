// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-reasoning. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/reasoning/cot.ts
function cotScaffold(question, mode = "concise") {
  if (mode === "off") return question;
  const instruction = mode === "full" ? "Think step by step. Show your reasoning explicitly, then end with a line starting with 'Final answer:'." : "Think step by step before answering, then give a concise final answer.";
  return `${question}

${instruction}`;
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

// packages/plugin-reasoning/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var chatConfigSchematics = createConfigSchematics().field(
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
        displayName: "Full (explicit reasoning + 'Final answer:')"
      }
    ]
  },
  "concise"
).build();

// packages/plugin-reasoning/src/index.ts
async function preprocess(ctl, userMessage) {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;
  const mode = ctl.getPluginConfig(chatConfigSchematics).get("cotMode");
  if (mode === "off") return userMessage;
  return cotScaffold(text, mode);
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withPromptPreprocessor(preprocess);
}
export {
  main,
  preprocess
};
