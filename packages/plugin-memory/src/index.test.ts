import { describe, expect, it } from "vitest";
import type { ToolsProviderController } from "@lmstudio/sdk";
import { toolsProvider } from "./index";

function controller(
  knowledgeDir: string,
  enableWrite: boolean,
): ToolsProviderController {
  return {
    getGlobalPluginConfig: () => ({
      get: (k: string) => (k === "knowledgeDir" ? knowledgeDir : ""),
    }),
    getPluginConfig: () => ({
      get: (k: string) => (k === "enableWrite" ? enableWrite : undefined),
    }),
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController;
}

describe("memory toolsProvider gate", () => {
  it("exposes no tools unless a dir is set AND write is enabled", async () => {
    expect(await toolsProvider(controller("/tmp/notes", false))).toEqual([]);
    expect(await toolsProvider(controller("", true))).toEqual([]);
  });

  it("exposes remember/recall/forget when configured + enabled", async () => {
    const tools = (await toolsProvider(
      controller("/tmp/notes", true),
    )) as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "forget",
      "recall",
      "remember",
    ]);
  });
});
