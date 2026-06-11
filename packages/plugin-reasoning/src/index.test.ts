import { describe, expect, it } from "vitest";
import type { ChatMessage, PromptPreprocessorController } from "@lmstudio/sdk";
import { preprocess } from "./index";

const message = (text: string) =>
  ({ getText: () => text }) as unknown as ChatMessage;
const controller = (cotMode: string) =>
  ({
    getPluginConfig: () => ({ get: () => cotMode }),
  }) as unknown as PromptPreprocessorController;

describe("reasoning preprocess", () => {
  it("appends step-by-step scaffolding in concise mode", async () => {
    const out = await preprocess(
      controller("concise"),
      message("What is 17 * 23?"),
    );
    expect(out).toContain("What is 17 * 23?");
    expect(out).toContain("step by step");
  });

  it("returns the original message unchanged when off", async () => {
    const msg = message("hello");
    expect(await preprocess(controller("off"), msg)).toBe(msg);
  });

  it("passes through empty input", async () => {
    const msg = message("   ");
    expect(await preprocess(controller("full"), msg)).toBe(msg);
  });
});
