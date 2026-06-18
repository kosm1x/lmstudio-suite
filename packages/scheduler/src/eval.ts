/**
 * Pure scheduling decisions — which jobs are due, and the next cron fire time.
 *
 * This is the only place `cron-parser` is used, and the scheduler is NOT a
 * plugin, so the dependency is fine here. (It deliberately does NOT live in
 * `core/schedule`, which is bundled into the schedule plugin under the
 * "only sdk/zod/node:* external" assertion — cron *validation* is dependency-
 * free there; cron *parsing* lives here.)
 *
 * No clock is read implicitly: `now` is always passed, so `isDue` is pure and
 * unit-testable.
 */
import { CronExpressionParser } from "cron-parser";
import type { ScheduleJob } from "@lmstudio-suite/core";

export interface DueVerdict {
  due: boolean;
  reason?: string;
}

/** The next cron occurrence strictly after `from`, evaluated in `timezone`. */
export function advanceCron(cron: string, timezone: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone })
    .next()
    .toDate();
}

/**
 * Decide whether a job should fire at `now`.
 *
 * - disabled → never.
 * - `runRequestedAt` set (run_schedule_now) → due immediately.
 * - one-shot `at` → due once its time has passed and it has not run yet.
 * - `cron` → due if the first scheduled occurrence after the last run (or the
 *   job's creation, if it has never run) has passed. This collapses any
 *   occurrences missed while the daemon was down to a SINGLE catch-up fire:
 *   after firing, `lastRunAt` advances to `now`, so the next baseline is now.
 */
export function isDue(job: ScheduleJob, now: Date): DueVerdict {
  if (!job.enabled) return { due: false };
  if (job.runRequestedAt) return { due: true, reason: "run requested" };

  if (job.at) {
    if (job.lastRunAt) return { due: false }; // one-shot already fired
    const at = new Date(job.at);
    if (Number.isNaN(at.getTime())) return { due: false };
    return at.getTime() <= now.getTime()
      ? { due: true, reason: "one-shot time reached" }
      : { due: false };
  }

  if (job.cron) {
    const baseline = new Date(job.lastRunAt ?? job.createdAt);
    if (Number.isNaN(baseline.getTime())) return { due: false };
    try {
      const next = advanceCron(job.cron, job.timezone, baseline);
      return next.getTime() <= now.getTime()
        ? { due: true, reason: "cron occurrence due" }
        : { due: false };
    } catch {
      return { due: false }; // unparseable cron (validated at authoring) → skip
    }
  }

  return { due: false };
}
