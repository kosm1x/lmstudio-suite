/**
 * Thin helpers for talking *to* LM Studio from standalone SDK apps.
 * In-app plugins receive their model via the plugin controller and do not need
 * this; standalone agents/CLIs do.
 */
import { LMStudioClient } from "@lmstudio/sdk";

export type LMStudioClientOptions = ConstructorParameters<
  typeof LMStudioClient
>[0];

/**
 * Create an LMStudioClient. With no arguments it connects to the local LM Studio
 * server on its default port. Pass options to point at a remote/custom server.
 */
export function createClient(options?: LMStudioClientOptions): LMStudioClient {
  return new LMStudioClient(options);
}
