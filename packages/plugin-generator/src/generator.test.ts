import { describe, it, expect } from "vitest";
import type { Chat } from "@lmstudio/sdk";
import { respondTo, lastUserText } from "./generator";

describe("respondTo", () => {
  it("evaluates arithmetic", () => {
    expect(respondTo("(3 + 4) * 2")).toBe("(3 + 4) * 2 = 14");
    expect(respondTo("2 ^ 10")).toBe("2 ^ 10 = 1024");
  });

  it("explains itself on non-arithmetic and empty input", () => {
    expect(respondTo("hello there")).toMatch(/only evaluate arithmetic/);
    expect(respondTo("   ")).toMatch(/Send me an arithmetic expression/);
  });
});

describe("lastUserText", () => {
  it("returns the most recent user message", () => {
    const history = {
      getMessagesArray: () => [
        { getRole: () => "user", getText: () => "first" },
        { getRole: () => "assistant", getText: () => "reply" },
        { getRole: () => "user", getText: () => "second" },
      ],
    } as unknown as Chat;
    expect(lastUserText(history)).toBe("second");
  });

  it("returns empty string when there is no user message", () => {
    const history = {
      getMessagesArray: () => [
        { getRole: () => "system", getText: () => "sys" },
      ],
    } as unknown as Chat;
    expect(lastUserText(history)).toBe("");
  });
});
