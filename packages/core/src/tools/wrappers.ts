/**
 * Tool decorators — compose over any `Tool[]` without touching the builders.
 *
 * - withTrace: log every tool call (name, args, result, duration) to a sink,
 *   for debugging agent loops.
 * - withApproval: gate mutating tools behind a confirm callback (the CLI wires
 *   an interactive y/n prompt; in-app, LM Studio's per-tool Ask/Allow already
 *   does this).
 *
 * Both preserve the tool's schema/validation — only `implementation` is wrapped.
 */
import type { Tool, ToolCallContext } from "@lmstudio/sdk";

/** The implemented tool variants expose a callable implementation. */
type ToolImpl = (
  params: Record<string, unknown>,
  ctx: ToolCallContext,
) => unknown;

export interface ToolCallTrace {
  /** Tool name. */
  name: string;
  /** Parsed arguments the model passed. */
  args: unknown;
  /** Stringified tool result. */
  result: string;
  /** Wall-clock duration of the implementation, ms. */
  ms: number;
  /** Start time (ms since epoch). */
  startedAt: number;
}

/** Wrap each tool so every call is reported to `sink` (e.g. a JSONL writer). */
export function withTrace(
  tools: Tool[],
  sink: (trace: ToolCallTrace) => void,
): Tool[] {
  return tools.map((t): Tool => {
    const inner = (t as { implementation?: ToolImpl }).implementation;
    if (typeof inner !== "function") return t; // remote/unimplemented — leave as-is
    return {
      ...t,
      implementation: async (params, ctx) => {
        const startedAt = Date.now();
        const start = performance.now();
        const result = await inner(params, ctx);
        sink({
          name: t.name,
          args: params,
          result: typeof result === "string" ? result : JSON.stringify(result),
          ms: Math.round(performance.now() - start),
          startedAt,
        });
        return result;
      },
    } as Tool;
  });
}

/** Tools that create, modify, delete, run, or send — the ones worth confirming. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "move_file",
  "make_dir",
  "run_shell",
  "download_file",
  "remember",
  "forget",
  "write_node",
  "organize_incoming",
]);

/** http_request is mutating only for non-GET/HEAD methods; others are read-only. */
export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name) || name === "http_request";
}

export interface ApprovalOptions {
  /**
   * Decide whether a tool needs confirmation, by name (default: isMutatingTool).
   * Evaluated once per tool when wrapping — it gates on identity, not per-call
   * arguments (use `approve` for arg-aware decisions).
   */
  needsApproval?: (name: string) => boolean;
  /** Ask the user; return true to allow. Async (e.g. a stdin prompt). */
  approve: (name: string, args: unknown) => boolean | Promise<boolean>;
}

/**
 * Wrap mutating tools so they ask `approve()` before running. A declined call
 * returns a message instead of executing — never throws, so the agent loop
 * continues. Non-mutating tools are returned untouched.
 */
export function withApproval(tools: Tool[], options: ApprovalOptions): Tool[] {
  const needs = options.needsApproval ?? ((name) => isMutatingTool(name));
  return tools.map((t): Tool => {
    if (!needs(t.name)) return t;
    const inner = (t as { implementation?: ToolImpl }).implementation;
    if (typeof inner !== "function") return t;
    return {
      ...t,
      implementation: async (params, ctx) => {
        const ok = await options.approve(t.name, params);
        if (!ok) return `Declined: the user did not approve running ${t.name}.`;
        return inner(params, ctx);
      },
    } as Tool;
  });
}
