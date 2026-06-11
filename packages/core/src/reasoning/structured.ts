/**
 * Schema-validated generation with retry-on-invalid.
 *
 * Decoupled from the SDK via a minimal `StructuredModel` interface so the retry
 * logic is unit-testable with a fake model; standalone SDK apps pass an adapter
 * around `llm.respond(prompt, { structured })`.
 */
import type { ZodType } from "zod";
import { extractJson } from "./extract-json";

export interface RespondResult {
  /** The SDK's already-parsed structured value, if it produced one. */
  parsed?: unknown;
  /** The raw text response. */
  content: string;
}

export interface StructuredModel {
  respond(
    prompt: string,
    options: { structured: ZodType },
  ): Promise<RespondResult>;
}

export interface GenerateStructuredOptions {
  /** Max attempts before throwing (default 3). */
  maxAttempts?: number;
}

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Ask the model for output matching `schema`, retrying with a correction note
 * when the result is missing or invalid. Returns the validated value or throws
 * after exhausting attempts.
 */
export async function generateStructured<T>(
  model: StructuredModel,
  prompt: string,
  schema: ZodType<T>,
  options: GenerateStructuredOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let lastError: unknown;
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await model.respond(currentPrompt, { structured: schema });
      // Treat an explicit `parsed: null` as a real value (e.g. z.null()); only
      // fall back to text extraction when the SDK produced no parsed value.
      const candidate =
        result.parsed !== undefined
          ? result.parsed
          : extractJson(result.content);
      return schema.parse(candidate);
    } catch (err) {
      lastError = err;
      currentPrompt =
        `${prompt}\n\nYour previous response was invalid (${errMsg(err)}). ` +
        `Respond with ONLY a JSON value matching the required schema, no prose.`;
    }
  }
  throw new Error(
    `Failed to produce valid structured output after ${maxAttempts} attempts: ${errMsg(lastError)}`,
  );
}
