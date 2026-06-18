import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScheduleTools,
  type ScheduleToolsOptions,
} from "./schedule-tools";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createScheduleTools>[number]["implementation"]>
>[1];

const NOW = new Date("2026-06-18T20:30:05Z");
let root = "";

function call(
  name: string,
  params: Record<string, unknown>,
  opts: Partial<ScheduleToolsOptions> = {},
): Promise<string> {
  const t = createScheduleTools({
    root,
    now: () => NOW,
    defaultTimezone: "UTC",
    ...opts,
  }).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t.implementation!(params, ctx) as Promise<string>;
}

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "schedule-tools-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("schedule_task", () => {
  it("creates a cron job and is idempotent on re-run", async () => {
    const r = await call("schedule_task", {
      name: "Morning briefing",
      prompt: "Summarize my inbox",
      cron: "0 9 * * *",
      timezone: "America/Mexico_City",
    });
    expect(r).toMatch(/Scheduled "morning-briefing"/);
    expect(r).toMatch(/does not execute it/); // daemon note present

    const again = await call("schedule_task", {
      name: "Morning briefing",
      prompt: "Summarize my inbox",
      cron: "0 9 * * *",
      timezone: "America/Mexico_City",
    });
    expect(again).toMatch(/unchanged/);
  });

  it("creates a one-shot `at` job", async () => {
    const r = await call("schedule_task", {
      name: "Reminder",
      prompt: "Wish happy birthday",
      at: "2026-12-25T09:00:00Z",
    });
    expect(r).toMatch(/Scheduled "reminder"/);
    expect(r).toMatch(/at 2026-12-25T09:00:00Z/);
  });

  it("rejects both/neither timing and an invalid cron", async () => {
    expect(
      await call("schedule_task", {
        name: "x",
        prompt: "p",
        cron: "0 9 * * *",
        at: "2026-12-25T09:00:00Z",
      }),
    ).toMatch(/either cron or at, not both/);
    expect(await call("schedule_task", { name: "x", prompt: "p" })).toMatch(
      /provide a schedule/,
    );
    expect(
      await call("schedule_task", {
        name: "x",
        prompt: "p",
        cron: "99 9 * * *",
      }),
    ).toMatch(/invalid cron/);
  });

  it("warns when a one-shot time is already in the past", async () => {
    const r = await call("schedule_task", {
      name: "Past",
      prompt: "p",
      at: "2020-01-01T00:00:00Z",
    });
    expect(r).toMatch(/in the past/);
  });
});

describe("list_schedules", () => {
  it("reports empty, then lists and filters by enabled", async () => {
    expect(await call("list_schedules", {})).toBe("No schedules.");
    await call("schedule_task", { name: "A", prompt: "p", cron: "0 9 * * *" });
    await call("schedule_task", { name: "B", prompt: "p", cron: "0 9 * * *" });
    await call("update_schedule", { id: "b", enabled: false });

    const all = await call("list_schedules", {});
    expect(all).toMatch(/\[a\] A/);
    expect(all).toMatch(/\[b\] B/);

    const onlyEnabled = await call("list_schedules", { enabled_only: true });
    expect(onlyEnabled).toMatch(/\[a\] A/);
    expect(onlyEnabled).not.toMatch(/\[b\] B/);
  });
});

describe("cancel_schedule", () => {
  it("removes an existing schedule and reports a miss", async () => {
    await call("schedule_task", {
      name: "Doomed",
      prompt: "p",
      cron: "0 9 * * *",
    });
    expect(await call("cancel_schedule", { id: "doomed" })).toMatch(
      /Cancelled "doomed"/,
    );
    expect(await call("cancel_schedule", { id: "doomed" })).toMatch(
      /No schedule with id/,
    );
  });

  it("treats a path-traversal id as a safe slug, not a filesystem escape", async () => {
    // id sanitization (toScheduleId) must run before any fs access.
    expect(await call("cancel_schedule", { id: "../../etc/passwd" })).toMatch(
      /No schedule with id/,
    ); // slugified to a non-existent id
  });
});

describe("update_schedule", () => {
  it("switches timing from cron to at and clears the cron", async () => {
    await call("schedule_task", {
      name: "Flex",
      prompt: "p",
      cron: "0 9 * * *",
    });
    const r = await call("update_schedule", {
      id: "flex",
      at: "2026-07-01T12:00:00Z",
    });
    expect(r).toMatch(/at 2026-07-01T12:00:00Z/);
    expect(r).not.toMatch(/cron/);
  });

  it("errors on a missing id and on both-timings", async () => {
    expect(await call("update_schedule", { id: "ghost", prompt: "x" })).toMatch(
      /No schedule with id/,
    );
    await call("schedule_task", { name: "Y", prompt: "p", cron: "0 9 * * *" });
    expect(
      await call("update_schedule", {
        id: "y",
        cron: "0 8 * * *",
        at: "2026-07-01T12:00:00Z",
      }),
    ).toMatch(/not both/);
  });
});

describe("run_schedule_now", () => {
  it("marks a job for immediate run and reports a miss", async () => {
    await call("schedule_task", {
      name: "Test job",
      prompt: "p",
      cron: "0 9 * * *",
    });
    expect(await call("run_schedule_now", { id: "test-job" })).toMatch(
      /Queued "test-job"/,
    );
    expect(await call("list_schedules", {})).toMatch(/run requested/);
    expect(await call("run_schedule_now", { id: "nope" })).toMatch(
      /No schedule with id/,
    );
  });
});
