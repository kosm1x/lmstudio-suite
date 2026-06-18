/**
 * schedule — an LM Studio Tools Provider for authoring scheduled/cron tasks.
 *
 * The model can create, list, update, cancel, and request-now scheduled tasks;
 * the specs are written as JSON under the configured schedule directory. An
 * external scheduler daemon (run on the same machine as LM Studio) reads that
 * directory and fires the jobs — a plugin has no way to run on a timer, so this
 * is the authoring half only. Every tool says so.
 *
 * Inert until a Schedule directory is configured (and the daemon is running).
 */
import type {
  PluginContext,
  Tool,
  ToolsProviderController,
} from "@lmstudio/sdk";
import { createScheduleTools, hostTimezone } from "@lmstudio-suite/core";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chatConfigSchematics, globalConfigSchematics } from "./config";

/** Expand a leading ~ and resolve; "" stays "". */
function expandHome(p: string): string {
  const t = p.trim();
  if (!t) return "";
  const expanded =
    t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve(expanded);
}

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("scheduleDir"));
  // Inert until a schedule directory is configured and the tools are enabled.
  if (!dir || !chat.get("enableTools")) return [];
  const tz = global.get("timezone").trim() || hostTimezone();
  return createScheduleTools({ root: dir, defaultTimezone: tz });
}

export async function main(context: PluginContext) {
  context
    .withConfigSchematics(chatConfigSchematics)
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withToolsProvider(toolsProvider);
}
