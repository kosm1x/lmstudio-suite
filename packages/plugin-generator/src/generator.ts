/**
 * Pure logic for the calculator generator — kept out of the SDK entry point so
 * it is unit-testable without a GeneratorController.
 */
import type { Chat } from "@lmstudio/sdk";
import { evalArithmetic } from "@lmstudio-suite/core";

/** Compute the generator's reply for a user message (deterministic, no LLM). */
export function respondTo(message: string): string {
  const expr = message.trim();
  if (!expr) return "Send me an arithmetic expression, e.g. (3 + 4) * 2.";
  try {
    return `${expr} = ${evalArithmetic(expr)}`;
  } catch {
    return `I only evaluate arithmetic (+ - * / % ^ and parentheses). "${expr}" isn't one — try e.g. 2 ^ 10.`;
  }
}

/** The text of the most recent user message in the history, or "". */
export function lastUserText(history: Chat): string {
  const messages = history.getMessagesArray();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.getRole() === "user") return m.getText();
  }
  return "";
}
