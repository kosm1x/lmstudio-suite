#!/usr/bin/env -S npx tsx
/**
 * lmstudio-scheduler — the daemon that makes scheduled tasks real.
 *
 * Polls the schedule store written by the `schedule` plugin / tools, and fires
 * due jobs against LM Studio via an agentic `.act()`. Run it on the same
 * machine as LM Studio (keep it alive with launchd / pm2). A plugin cannot do
 * this — its code only runs while the model is responding; this process runs on
 * a timer.
 */
import { resolve, join } from "node:path";
import { ScheduleStore } from "@lmstudio-suite/core";
import { tickOnce } from "./runner";
import { createActRunner } from "./act-runner";

interface Config {
  dir: string;
  pollSec: number;
  cwd: string;
  model?: string;
  tz?: string;
  maxRounds: number;
  allowShell: boolean;
  help: boolean;
}

const HELP = `lmstudio-scheduler — fire scheduled tasks against LM Studio on time

Usage:
  npm start -w @lmstudio-suite/scheduler -- --dir <schedule dir> [options]
  npx tsx src/main.ts --dir <schedule dir> [options]

Options:
  --dir <path>       Schedule directory (the SAME one the schedule plugin writes). Required.
  --poll <seconds>   Poll interval (default 30)
  --cwd <path>       Working dir for the jobs' fs/data tools (default: <dir>/work)
  --model <id>       Default model for jobs that don't set one (default: loaded model)
  --tz <zone>        Default IANA timezone (default: this machine's)
  --max-rounds <n>   Max agentic rounds per job (default 8)
  --allow-shell      Let jobs that request the 'shell' group run run_shell (off by default;
                     unsandboxed — only enable if you trust every scheduled job)
  -h, --help         Show this help

Environment fallbacks: SCHEDULE_DIR, SCHEDULE_POLL_SEC, SCHEDULE_CWD, SCHEDULE_MODEL, SCHEDULE_TZ, SCHEDULE_ALLOW_SHELL

LM Studio must be running with its local server on and a tool-capable model loaded.
Run logs are written to <dir>/runs/<id>/<timestamp>.md.`;

function parseConfig(argv: string[]): Config {
  const env = process.env;
  const cfg: Config = {
    dir: env["SCHEDULE_DIR"] ? resolve(env["SCHEDULE_DIR"]) : "",
    pollSec: Math.max(1, Number(env["SCHEDULE_POLL_SEC"] ?? "30") || 30),
    cwd: env["SCHEDULE_CWD"] ? resolve(env["SCHEDULE_CWD"]) : "",
    model: env["SCHEDULE_MODEL"] || undefined,
    tz: env["SCHEDULE_TZ"] || undefined,
    maxRounds: 8,
    allowShell: /^(1|true|yes)$/i.test(env["SCHEDULE_ALLOW_SHELL"] ?? ""),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case "--dir":
        cfg.dir = resolve(argv[++i] ?? ".");
        break;
      case "--poll":
        cfg.pollSec = Math.max(1, Number(argv[++i] ?? "30") || 30);
        break;
      case "--cwd":
        cfg.cwd = resolve(argv[++i] ?? ".");
        break;
      case "--model":
        cfg.model = argv[++i];
        break;
      case "--tz":
        cfg.tz = argv[++i];
        break;
      case "--max-rounds":
        cfg.maxRounds = Math.max(1, Number(argv[++i] ?? "8") || 8);
        break;
      case "--allow-shell":
        cfg.allowShell = true;
        break;
      case "--help":
      case "-h":
        cfg.help = true;
        break;
    }
  }
  // Default the jobs' working dir to a `work/` subdir, NOT the schedule dir
  // itself — otherwise a job's fs tools could read/rewrite other jobs' specs.
  if (!cfg.cwd) cfg.cwd = join(cfg.dir, "work");
  return cfg;
}

function log(msg: string): void {
  process.stderr.write(`[scheduler ${new Date().toISOString()}] ${msg}\n`);
}

/** Sleep `ms`, but wake early (within ~250ms) once `stopped()` turns true. */
async function interruptibleSleep(
  ms: number,
  stopped: () => boolean,
): Promise<void> {
  const step = 250;
  let waited = 0;
  while (waited < ms && !stopped()) {
    const chunk = Math.min(step, ms - waited);
    await new Promise<void>((r) => setTimeout(r, chunk));
    waited += chunk;
  }
}

async function run(): Promise<void> {
  const cfg = parseConfig(process.argv.slice(2));
  if (cfg.help || !cfg.dir) {
    process.stdout.write(HELP + "\n");
    process.exit(cfg.help ? 0 : 1);
  }

  const store = new ScheduleStore(cfg.dir);
  const runJob = createActRunner({
    cwd: cfg.cwd,
    runsRoot: join(cfg.dir, "runs"),
    defaultTimezone: cfg.tz,
    defaultModel: cfg.model,
    maxRounds: cfg.maxRounds,
    allowShell: cfg.allowShell,
  });

  let stopped = false;
  const stop = (sig: string): void => {
    if (stopped) return;
    log(`${sig} received — finishing the current tick, then stopping`);
    stopped = true;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  log(
    `watching ${cfg.dir}/schedules every ${cfg.pollSec}s ` +
      `(cwd ${cfg.cwd}${cfg.model ? `, default model ${cfg.model}` : ""})`,
  );

  while (!stopped) {
    try {
      const result = await tickOnce(store, new Date(), runJob, log);
      if (result.fired.length > 0) {
        log(
          `fired ${result.fired.length}: ` +
            result.fired
              .map((f) => `${f.id}${f.ok ? "" : " (failed)"}`)
              .join(", "),
        );
      }
    } catch (err) {
      // The loop must survive any tick error (LM Studio down, fs hiccup, …).
      log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (stopped) break;
    await interruptibleSleep(cfg.pollSec * 1000, () => stopped);
  }
  log("stopped");
  process.exit(0);
}

run().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
