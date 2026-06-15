/**
 * calc-generator — an LM Studio Generator plugin.
 *
 * A Generator REPLACES the local LLM as the token source: instead of a model
 * producing the assistant reply, this function does. As a concrete, dependency-
 * free example it acts as a deterministic calculator — it reads the last user
 * message, evaluates it as arithmetic (reusing core's evalArithmetic), and
 * streams the answer back fragment by fragment via `fragmentGenerated`.
 *
 * It's a template: swap `respondTo` for any token source — a rules engine, a
 * remote API, a retrieval-only responder — and you have a non-LLM "model".
 */
import type { Chat, GeneratorController, PluginContext } from "@lmstudio/sdk";
import { respondTo, lastUserText } from "./generator";

export async function generate(
  ctl: GeneratorController,
  history: Chat,
): Promise<void> {
  const reply = respondTo(lastUserText(history));
  // Stream in whitespace-preserving fragments to demonstrate token-by-token
  // generation (a real generator would emit as its source produces).
  for (const fragment of reply.split(/(\s+)/)) {
    if (fragment) ctl.fragmentGenerated(fragment);
  }
}

export async function main(context: PluginContext) {
  context.withGenerator(generate);
}
