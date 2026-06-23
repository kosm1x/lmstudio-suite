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
var DEFAULT_SUMMARY_DIRECTIVE = [
  "Write a complete, well-narrated hand-off briefing for the AI agent that will",
  "continue this work in a fresh chat with NONE of the prior context. Address it",
  "directly to that agent as flowing, readable prose under short headed sections.",
  "Be thorough and self-contained: include everything needed to resume seamlessly,",
  "and use as much length as the material genuinely requires \u2014 do not cut detail",
  "for brevity. But stay information-dense: no padding, repetition, or filler.",
  "Cover the who / what / why / how / when: a full recap of the project and the",
  "work or story so far; the characters or people (names, roles, voices,",
  "relationships, arcs); the setting and timeline; the decisions made and the",
  "reasoning behind them; open threads, constraints, and the tone or style to",
  "honor; and exactly where things were left off with the immediate next step.",
  "Be concrete and specific \u2014 real names, facts, and short quotes where they",
  "matter. Narrate it as one continuous, coherent account, not terse fragments.",
  "Write the briefing directly: no reasoning, no analysis, no <think> blocks,",
  "no preamble."
].join("\n");

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
