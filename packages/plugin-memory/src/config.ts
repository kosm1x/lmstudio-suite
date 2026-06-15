/** Config for the memory (RAG) prompt-preprocessor. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "embeddingModel",
    "string",
    {
      displayName: "Embedding model",
      hint: "Identifier of an LM Studio embedding model to use for retrieval.",
      placeholder: "text-embedding-nomic-embed-text-v1.5",
    },
    "",
  )
  .field(
    "knowledgeDir",
    "string",
    {
      displayName: "Knowledge directory",
      hint: "Absolute path to a folder of .md/.txt files to retrieve context from. Leave blank to disable.",
      placeholder: "/home/me/notes",
    },
    "",
  )
  .build();

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "topK",
    "numeric",
    {
      displayName: "Snippets to retrieve",
      int: true,
      min: 1,
      max: 12,
      slider: { min: 1, max: 12, step: 1 },
    },
    4,
  )
  .field(
    "minScore",
    "numeric",
    {
      displayName: "Minimum similarity (0–1)",
      hint: "Only inject snippets at least this similar to the query.",
      min: 0,
      max: 1,
      step: 0.05,
      slider: { min: 0, max: 1, step: 0.05 },
    },
    0.35,
  )
  .field(
    "maxChars",
    "numeric",
    {
      displayName: "Max injected context characters",
      int: true,
      min: 200,
      max: 20_000,
    },
    2_000,
  )
  .field(
    "enableWrite",
    "boolean",
    {
      displayName: "Enable memory write tools",
      hint: "Expose remember / recall / forget so the model can save facts to the knowledge directory (retrieved automatically on later messages). Off by default.",
    },
    false,
  )
  .build();
