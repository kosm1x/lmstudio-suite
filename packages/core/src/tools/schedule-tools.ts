/**
 * SDK `tool()` builders for scheduling — the authoring half. The model can
 * create/list/update/cancel scheduled tasks and request an immediate run; the
 * specs are written to a `ScheduleStore` that the (Phase 2) scheduler daemon
 * reads and fires. These tools DO NOT execute anything — a plugin cannot run on
 * a timer. Every success message says so, so the model (and user) know a job is
 * recorded, not yet running.
 *
 * Reuses `core/time` for `at`/timezone validation and `core/schedule` for the
 * store, cron validation, and idempotent upsert (re-authoring an identical job
 * is a no-op, the same loop-breaking contract as the write tools).
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import {
  ScheduleStore,
  upsertSpec,
  validateCron,
  toScheduleId,
  type ScheduleJob,
  type ScheduleSpec,
} from "../schedule/index";
import { parseDate, assertTimezone, hostTimezone } from "../time/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const DAEMON_NOTE =
  "Note: scheduled jobs only run while the scheduler daemon is running — " +
  "this records the job, it does not execute it.";

export interface ScheduleToolsOptions {
  /** Root the schedule store is scoped to (jobs live under `<root>/<subdir>`). */
  root: string;
  /** Subfolder for job specs (default "schedules"). */
  subdir?: string;
  /** Clock source (tests inject a fixed one; default `() => new Date()`). */
  now?: () => Date;
  /** Default IANA timezone for cron jobs when none is passed (default: host). */
  defaultTimezone?: string;
}

/** One-line summary of a job for list output. */
function formatJob(job: ScheduleJob): string {
  const when = job.cron ? `cron "${job.cron}"` : `at ${job.at}`;
  const state = job.enabled ? "enabled" : "disabled";
  const last = job.lastRunAt ? ` | last run ${job.lastRunAt}` : "";
  const next = job.nextRunAt ? ` | next ${job.nextRunAt}` : "";
  const pending = job.runRequestedAt ? " | run requested" : "";
  return `[${job.id}] ${job.name} — ${when} (${job.timezone}), ${state}${next}${last}${pending}`;
}

export function createScheduleTools(options: ScheduleToolsOptions): Tool[] {
  const store = new ScheduleStore(options.root, options.subdir);
  const now = options.now ?? (() => new Date());
  const defaultTz = options.defaultTimezone?.trim()
    ? options.defaultTimezone.trim()
    : hostTimezone();

  /** Validate the timing + timezone shared by schedule_task/update_schedule. */
  function validateTiming(
    cron: string | undefined,
    at: string | undefined,
    timezone: string,
  ): string | null {
    if (cron && at) return "provide either cron or at, not both";
    if (!cron && !at) return "provide a schedule: either cron or at";
    if (cron) {
      const v = validateCron(cron);
      if (!v.ok) return `invalid cron: ${v.reason}`;
    }
    if (at) {
      try {
        parseDate(at);
      } catch (err) {
        return msg(err);
      }
    }
    try {
      assertTimezone(timezone);
    } catch (err) {
      return msg(err);
    }
    return null;
  }

  return [
    tool({
      name: "schedule_task",
      description:
        "Schedule a task to run later — either on a recurring cron schedule or once at a " +
        "specific time. The task is a natural-language instruction the agent will carry out " +
        "when it fires. Re-running with the same name updates that schedule in place. " +
        DAEMON_NOTE,
      parameters: {
        name: z
          .string()
          .describe(
            "Short name for the schedule (also its id), e.g. 'morning briefing'.",
          ),
        prompt: z
          .string()
          .describe("The task to perform when it fires, in plain language."),
        cron: z
          .string()
          .optional()
          .describe(
            "Cron expression (5 or 6 fields), e.g. '0 9 * * *' for 9am daily.",
          ),
        at: z
          .string()
          .optional()
          .describe(
            "One-shot ISO-8601 datetime, e.g. '2026-12-25T09:00:00Z'. Use instead of cron.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            `IANA timezone for a cron schedule. Default: ${defaultTz}.`,
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Optional model id the run should use (default: the loaded model).",
          ),
        tools: z
          .array(z.string())
          .optional()
          .describe(
            "Optional tool groups the run should enable (e.g. ['web','fs']).",
          ),
        id: z
          .string()
          .optional()
          .describe(
            "Explicit id to create/overwrite. Omit to derive it from the name.",
          ),
      },
      implementation: async (
        { name, prompt, cron, at, timezone, model, tools, id },
        { status, warn },
      ) => {
        status("schedule_task");
        if (!name.trim()) return "Error: name must not be empty.";
        if (!prompt.trim()) return "Error: prompt must not be empty.";
        const tz = timezone?.trim() || defaultTz;
        const bad = validateTiming(cron, at, tz);
        if (bad) return `Error: ${bad}.`;
        try {
          const spec: ScheduleSpec = {
            name: name.trim(),
            cron,
            at,
            timezone: tz,
            prompt: prompt.trim(),
            model,
            tools,
            enabled: true,
          };
          const jobId = toScheduleId(id?.trim() || name);
          const { status: st, job } = await upsertSpec(
            store,
            jobId,
            spec,
            now(),
          );
          const past =
            at && parseDate(at).getTime() < now().getTime()
              ? " WARNING: that time is in the past and will not fire."
              : "";
          if (st === "unchanged")
            return `Already scheduled as "${job.id}" — unchanged. ${DAEMON_NOTE}`;
          return `${st === "created" ? "Scheduled" : "Updated"} "${job.id}": ${formatJob(job)}.${past}\n${DAEMON_NOTE}`;
        } catch (err) {
          warn(`schedule_task failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "list_schedules",
      description:
        "List saved scheduled tasks with their timing, enabled state, and last/next run. " +
        "Use to see what is scheduled or to find an id to update or cancel.",
      parameters: {
        enabled_only: z
          .boolean()
          .default(false)
          .describe("Only show enabled schedules."),
      },
      implementation: async ({ enabled_only }, { status, warn }) => {
        status("list_schedules");
        try {
          let jobs = await store.list();
          if (enabled_only) jobs = jobs.filter((j) => j.enabled);
          if (jobs.length === 0) return "No schedules.";
          return `${jobs.map(formatJob).join("\n")}\n\n${DAEMON_NOTE}`;
        } catch (err) {
          warn(`list_schedules failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "cancel_schedule",
      description:
        "Delete a scheduled task by its id (use list_schedules to find it). Irreversible.",
      parameters: {
        id: z.string().describe("The id of the schedule to cancel."),
      },
      implementation: async ({ id }, { status, warn }) => {
        status("cancel_schedule");
        try {
          const safeId = toScheduleId(id);
          const removed = await store.remove(safeId);
          return removed
            ? `Cancelled "${safeId}".`
            : `No schedule with id "${id}". Use list_schedules to see ids.`;
        } catch (err) {
          warn(`cancel_schedule failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "update_schedule",
      description:
        "Change fields of an existing schedule (its timing, prompt, timezone, model, tools, " +
        "or enable/disable it). Only the fields you pass change. Switch timing by passing the " +
        "new cron OR at (the other is cleared).",
      parameters: {
        id: z.string().describe("The id of the schedule to update."),
        name: z.string().optional().describe("New display name."),
        prompt: z.string().optional().describe("New task instruction."),
        cron: z
          .string()
          .optional()
          .describe("New cron expression (clears any `at`)."),
        at: z
          .string()
          .optional()
          .describe("New one-shot datetime (clears any cron)."),
        timezone: z.string().optional().describe("New IANA timezone."),
        model: z.string().optional().describe("New model id."),
        tools: z.array(z.string()).optional().describe("New tool-group list."),
        enabled: z
          .boolean()
          .optional()
          .describe("Enable (true) or disable (false) the schedule."),
      },
      implementation: async (
        { id, name, prompt, cron, at, timezone, model, tools, enabled },
        { status, warn },
      ) => {
        status("update_schedule");
        try {
          const safeId = toScheduleId(id);
          const existing = await store.get(safeId);
          if (!existing)
            return `No schedule with id "${id}". Use list_schedules to see ids.`;
          if (cron && at) return "Error: provide either cron or at, not both.";

          // Switching timing replaces it; otherwise keep the existing timing.
          let nextCron = existing.cron;
          let nextAt = existing.at;
          if (cron) {
            nextCron = cron;
            nextAt = undefined;
          } else if (at) {
            nextAt = at;
            nextCron = undefined;
          }
          const tz = timezone?.trim() || existing.timezone;
          const bad = validateTiming(nextCron, nextAt, tz);
          if (bad) return `Error: ${bad}.`;

          const spec: ScheduleSpec = {
            name: name?.trim() || existing.name,
            cron: nextCron,
            at: nextAt,
            timezone: tz,
            prompt: prompt?.trim() || existing.prompt,
            model: model ?? existing.model,
            tools: tools ?? existing.tools,
            enabled: enabled ?? existing.enabled,
          };
          const { status: st, job } = await upsertSpec(
            store,
            safeId,
            spec,
            now(),
          );
          return st === "unchanged"
            ? `No change to "${job.id}".`
            : `Updated "${job.id}": ${formatJob(job)}.`;
        } catch (err) {
          warn(`update_schedule failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "run_schedule_now",
      description:
        "Request that a scheduled task run as soon as possible (on the scheduler's next " +
        "poll), without waiting for its scheduled time. Useful for testing a schedule. " +
        DAEMON_NOTE,
      parameters: {
        id: z.string().describe("The id of the schedule to run now."),
      },
      implementation: async ({ id }, { status, warn }) => {
        status("run_schedule_now");
        try {
          const safeId = toScheduleId(id);
          const job = await store.get(safeId);
          if (!job)
            return `No schedule with id "${id}". Use list_schedules to see ids.`;
          job.runRequestedAt = now().toISOString();
          await store.save(job);
          return `Queued "${safeId}" to run on the scheduler's next poll. ${DAEMON_NOTE}`;
        } catch (err) {
          warn(`run_schedule_now failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
  ];
}
