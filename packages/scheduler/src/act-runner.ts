/**
 * The real `runJob`: connect to LM Studio, build the job's tool set, run an
 * agentic `.act()`, write a run log, and return a short result summary.
 *
 * This is the I/O half of the daemon — it is wired into `tickOnce` as the
 * injected port and is not unit-tested (the pure scheduling logic in eval.ts /
 * runner.ts is). It composes the SAME `core/tools` builders the plugins and the
 * agent CLI use — no tool implementation is duplicated.
 */
import {
  createClient,
  ScopedFs,
  scanKbDir,
  createTimeTools,
  createFsTools,
  createDataTools,
  createWebTools,
  createHttpTools,
  createShellTool,
  createMemoryTools,
  createMapTools,
  hostTimezone,
  timeContextLine,
  type KbGraph,
  type ScheduleJob,
} from "@lmstudio-suite/core";
import type { LMStudioClient, Tool } from "@lmstudio/sdk";
import type { RunJob } from "./runner";

/** Tool groups a job gets when it does not name any explicitly. */
const DEFAULT_GROUPS = ["time", "fs", "data", "web"];

export interface ActRunnerOptions {
  /** Working directory for the fs/data/shell/memory/kb tools. */
  cwd: string;
  /** Directory run logs are written under (e.g. <scheduleDir>/runs). */
  runsRoot: string;
  /** Default timezone for the time tools + injected date line. */
  defaultTimezone?: string;
  /** Default model id for jobs that don't set one (default: the loaded model). */
  defaultModel?: string;
  /** Max agentic rounds per job (default 8). */
  maxRounds?: number;
  /**
   * Allow jobs that request the `shell` group to get a (powerful, unsandboxed)
   * run_shell tool. Off by default: an unattended daemon should not run arbitrary
   * shell on the model's say-so unless the operator explicitly opted in.
   */
  allowShell?: boolean;
  /** Injected LM Studio client (default: createClient()). */
  client?: LMStudioClient;
  /** Clock for the run-log filename (default: () => new Date()). */
  now?: () => Date;
}

/** Compose the core tool builders named by `groups`, scoped to `cwd`. */
export function buildJobTools(
  groups: string[] | undefined,
  opts: { cwd: string; timezone: string; allowShell: boolean },
): Tool[] {
  const want = new Set(
    (groups && groups.length ? groups : DEFAULT_GROUPS).map((g) =>
      g.toLowerCase(),
    ),
  );
  const tools: Tool[] = [];
  if (want.has("time"))
    tools.push(...createTimeTools({ defaultTimezone: opts.timezone }));
  if (want.has("fs")) tools.push(...createFsTools({ root: opts.cwd }));
  if (want.has("data")) tools.push(...createDataTools({ root: opts.cwd }));
  if (want.has("web"))
    tools.push(
      ...createWebTools({
        search: { provider: "duckduckgo" },
        allowPrivateHosts: false,
      }),
    );
  if (want.has("http"))
    tools.push(
      ...createHttpTools({ root: opts.cwd, allowPrivateHosts: false }),
    );
  if (want.has("shell") && opts.allowShell)
    tools.push(createShellTool({ cwd: opts.cwd }));
  if (want.has("memory")) tools.push(...createMemoryTools({ root: opts.cwd }));
  if (want.has("kb")) {
    let graph: KbGraph | undefined;
    const loadGraph = async (): Promise<KbGraph> =>
      (graph ??= (await scanKbDir(opts.cwd)).graph);
    tools.push(...createMapTools({ root: opts.cwd, loadGraph }));
  }
  return tools;
}

/** Filesystem-safe timestamp for a run-log filename. */
function fsSafeStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export function createActRunner(options: ActRunnerOptions): RunJob {
  const now = options.now ?? (() => new Date());
  const fallbackTz = options.defaultTimezone?.trim() || hostTimezone();
  const maxRounds = options.maxRounds ?? 8;
  const runs = new ScopedFs(options.runsRoot);

  return async (job: ScheduleJob): Promise<string> => {
    const client = options.client ?? createClient();
    const modelId = job.model || options.defaultModel;
    const model = modelId
      ? await client.llm.model(modelId)
      : await client.llm.model();

    const timezone = job.timezone || fallbackTz;
    const tools = buildJobTools(job.tools, {
      cwd: options.cwd,
      timezone,
      allowShell: options.allowShell ?? false,
    });
    const firedAt = now();
    // Prepend the current date/time so a scheduled job knows when it ran.
    const prompt = `${timeContextLine(firedAt, timezone)}\n\n${job.prompt}`;

    const out: string[] = [];
    const result = await model.act(prompt, tools, {
      maxPredictionRounds: maxRounds,
      onMessage: (m) => {
        if (m.getRole() === "assistant") {
          const t = m.getText();
          if (t) out.push(t);
        }
      },
    });
    const text = out.join("\n").trim();

    const body =
      `# ${job.name}\n\n` +
      `- id: ${job.id}\n` +
      `- fired: ${firedAt.toISOString()}\n` +
      `- rounds: ${result.rounds}\n` +
      `- tools: ${tools.map((t) => t.name).join(", ")}\n\n` +
      `## Prompt\n\n${job.prompt}\n\n## Result\n\n${text || "(no text output)"}\n`;
    await runs.writeFile(`${job.id}/${fsSafeStamp(firedAt)}.md`, body);

    return text || `(completed in ${result.rounds} round(s), no text output)`;
  };
}
