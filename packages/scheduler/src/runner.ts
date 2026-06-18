/**
 * The tick: find due jobs, fire them via an injected `runJob` port, and persist
 * the outcome. Splitting the firing behind a port keeps this function pure of
 * LM Studio I/O — tests drive it with a real temp store, a fake `runJob`, and a
 * fixed clock (integration over mocks).
 */
import { ScheduleStore, type ScheduleJob } from "@lmstudio-suite/core";
import { advanceCron, isDue } from "./eval";

/** Fires a job and returns a short result summary. Throws on failure. */
export type RunJob = (job: ScheduleJob) => Promise<string>;

export interface FiredJob {
  id: string;
  ok: boolean;
  reason: string;
}
export interface TickResult {
  fired: FiredJob[];
}

const LAST_RESULT_MAX = 500;

/**
 * Run one scheduling pass. Each due job is fired (errors are caught so one bad
 * job never stops the pass), then its state is persisted:
 * - `lastRunAt`/`lastResult` recorded (truncated), `runRequestedAt` cleared;
 * - one-shot `at` jobs are disabled (done, success or failure — no retry storm);
 * - cron jobs get `nextRunAt` advanced to the next occurrence.
 *
 * Setting `lastRunAt` on failure too is deliberate: a failing cron job waits for
 * its next occurrence rather than hammering every poll. The error is visible in
 * `lastResult` (and via list_schedules).
 */
export async function tickOnce(
  store: ScheduleStore,
  now: Date,
  runJob: RunJob,
  log: (msg: string) => void = () => {},
): Promise<TickResult> {
  const jobs = await store.list();
  const fired: FiredJob[] = [];

  for (const job of jobs) {
    const verdict = isDue(job, now);
    if (!verdict.due) continue;
    const reason = verdict.reason ?? "due";
    log(`firing "${job.id}" (${reason})`);

    let result: string;
    let ok = true;
    try {
      result = await runJob(job);
    } catch (err) {
      ok = false;
      result = `error: ${err instanceof Error ? err.message : String(err)}`;
      log(`job "${job.id}" failed: ${result}`);
    }

    const updated: ScheduleJob = {
      ...job,
      lastRunAt: now.toISOString(),
      lastResult: result.slice(0, LAST_RESULT_MAX),
      runRequestedAt: undefined, // clear any run_schedule_now marker
    };
    if (job.at) {
      updated.enabled = false; // one-shot: done
      updated.nextRunAt = undefined;
    } else if (job.cron) {
      try {
        updated.nextRunAt = advanceCron(
          job.cron,
          job.timezone,
          now,
        ).toISOString();
      } catch {
        updated.nextRunAt = undefined;
      }
    }
    await store.save(updated);
    fired.push({ id: job.id, ok, reason });
  }

  return { fired };
}
