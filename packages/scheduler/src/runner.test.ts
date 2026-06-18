import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduleStore, type ScheduleJob } from "@lmstudio-suite/core";
import { tickOnce, type RunJob } from "./runner";

let root = "";
let store: ScheduleStore;
const NOW = new Date("2026-06-18T20:30:05Z");

function makeJob(over: Partial<ScheduleJob>): ScheduleJob {
  return {
    id: "j",
    name: "J",
    timezone: "UTC",
    prompt: "p",
    enabled: true,
    createdAt: "2026-06-17T00:00:00Z",
    updatedAt: "2026-06-17T00:00:00Z",
    ...over,
  };
}

const okRun: RunJob = async () => "did the thing";

beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "scheduler-"));
  store = new ScheduleStore(root);
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("tickOnce", () => {
  it("fires a due one-shot, records the result, and disables it", async () => {
    await store.save(makeJob({ id: "once", at: "2026-06-18T20:00:00Z" }));
    const calls: string[] = [];
    const res = await tickOnce(store, NOW, async (j) => {
      calls.push(j.id);
      return "done";
    });
    expect(res.fired).toEqual([
      { id: "once", ok: true, reason: "one-shot time reached" },
    ]);
    expect(calls).toEqual(["once"]);
    const j = await store.get("once");
    expect(j?.enabled).toBe(false);
    expect(j?.lastRunAt).toBe(NOW.toISOString());
    expect(j?.lastResult).toBe("done");
  });

  it("fires a due cron job, advances nextRunAt, and leaves it enabled", async () => {
    await store.save(
      makeJob({
        id: "daily",
        cron: "0 9 * * *",
        lastRunAt: "2026-06-17T09:00:00Z",
      }),
    );
    await tickOnce(store, NOW, okRun);
    const j = await store.get("daily");
    expect(j?.enabled).toBe(true);
    expect(j?.lastRunAt).toBe(NOW.toISOString());
    expect(j?.nextRunAt).toBe("2026-06-19T09:00:00.000Z");
  });

  it("does not fire a not-due job", async () => {
    await store.save(makeJob({ id: "future", at: "2027-01-01T00:00:00Z" }));
    const res = await tickOnce(store, NOW, async () => {
      throw new Error("should not run");
    });
    expect(res.fired).toEqual([]);
  });

  it("clears the runRequestedAt marker after firing", async () => {
    await store.save(
      makeJob({
        id: "now-please",
        cron: "0 9 * * *",
        lastRunAt: "2026-06-18T09:00:00Z",
        runRequestedAt: "2026-06-18T20:00:00Z",
      }),
    );
    await tickOnce(store, NOW, okRun);
    const j = await store.get("now-please");
    expect(j?.runRequestedAt).toBeUndefined();
  });

  it("survives a throwing job, recording the error without a retry storm", async () => {
    await store.save(
      makeJob({
        id: "boom",
        cron: "0 9 * * *",
        lastRunAt: "2026-06-17T09:00:00Z",
      }),
    );
    const res = await tickOnce(store, NOW, async () => {
      throw new Error("kaboom");
    });
    expect(res.fired).toEqual([
      { id: "boom", ok: false, reason: "cron occurrence due" },
    ]);
    const j = await store.get("boom");
    expect(j?.enabled).toBe(true); // cron stays enabled for the next occurrence
    expect(j?.lastResult).toMatch(/error: kaboom/);
    expect(j?.lastRunAt).toBe(NOW.toISOString()); // recorded → waits for next occurrence
  });

  it("skips disabled jobs", async () => {
    await store.save(
      makeJob({ id: "off", enabled: false, at: "2026-06-18T20:00:00Z" }),
    );
    const res = await tickOnce(store, NOW, okRun);
    expect(res.fired).toEqual([]);
  });
});
