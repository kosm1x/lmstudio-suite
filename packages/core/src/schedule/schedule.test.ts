import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ScheduleStore,
  validateCron,
  specEquals,
  toScheduleId,
  upsertSpec,
  type ScheduleSpec,
} from "./schedule";

let root = "";
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "schedule-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

const NOW = new Date("2026-06-18T20:30:05Z");
const cronSpec = (over: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  name: "Morning briefing",
  cron: "0 9 * * *",
  timezone: "America/Mexico_City",
  prompt: "Summarize my inbox",
  enabled: true,
  ...over,
});

describe("validateCron", () => {
  it("accepts valid 5- and 6-field expressions", () => {
    expect(validateCron("0 9 * * *").ok).toBe(true);
    expect(validateCron("*/15 0-12 1,15 * 1-5").ok).toBe(true);
    expect(validateCron("30 0 9 * * 0").ok).toBe(true); // 6-field (seconds)
  });

  it("rejects wrong field counts, out-of-range, and bad steps", () => {
    expect(validateCron("0 9 * *")).toMatchObject({ ok: false });
    expect(validateCron("0 9 * * * * *")).toMatchObject({ ok: false });
    expect(validateCron("99 9 * * *")).toMatchObject({ ok: false }); // minute > 59
    expect(validateCron("0 9 * * 9")).toMatchObject({ ok: false }); // dow > 7
    expect(validateCron("*/0 9 * * *")).toMatchObject({ ok: false }); // step 0
    expect(validateCron("5-2 9 * * *")).toMatchObject({ ok: false }); // lo > hi
  });
});

describe("toScheduleId", () => {
  it("slugifies a name and falls back to 'job'", () => {
    expect(toScheduleId("Morning Briefing!")).toBe("morning-briefing");
    expect(toScheduleId("  ")).toBe("job");
  });

  it("neutralizes path-traversal ids (no '/', '.', or '..' survive)", () => {
    // The store builds `<subdir>/<id>.json`, so a crafted id must not escape.
    expect(toScheduleId("../../etc/passwd")).toBe("etc-passwd");
    expect(toScheduleId("..")).toBe("job");
    expect(toScheduleId("a/../../b")).toBe("a-b");
    for (const id of ["../../etc/passwd", "..", "a/../../b"]) {
      expect(toScheduleId(id)).not.toMatch(/[/.]/);
    }
  });
});

describe("specEquals", () => {
  it("ignores object key order, distinguishes real field changes", () => {
    expect(specEquals(cronSpec(), cronSpec())).toBe(true);
    expect(specEquals(cronSpec(), cronSpec({ prompt: "different" }))).toBe(
      false,
    );
    expect(specEquals(cronSpec(), cronSpec({ enabled: false }))).toBe(false);
  });
});

describe("ScheduleStore", () => {
  it("saves, gets, lists, and removes jobs", async () => {
    const store = new ScheduleStore(root);
    await upsertSpec(store, "a", cronSpec({ name: "A" }), NOW);
    await upsertSpec(store, "b", cronSpec({ name: "B" }), NOW);

    expect((await store.get("a"))?.name).toBe("A");
    expect((await store.list()).map((j) => j.id)).toEqual(["a", "b"]);
    expect(await store.exists("a")).toBe(true);

    expect(await store.remove("a")).toBe(true);
    expect(await store.remove("a")).toBe(false); // already gone
    expect((await store.list()).map((j) => j.id)).toEqual(["b"]);
  });

  it("returns [] when the store dir does not exist, and skips corrupt files", async () => {
    const store = new ScheduleStore(root);
    expect(await store.list()).toEqual([]);

    await fsp.mkdir(join(root, "schedules"), { recursive: true });
    await fsp.writeFile(join(root, "schedules", "bad.json"), "{not json");
    await upsertSpec(store, "ok", cronSpec(), NOW);
    expect((await store.list()).map((j) => j.id)).toEqual(["ok"]); // corrupt skipped
    expect(await store.get("bad")).toBeNull();
  });
});

describe("upsertSpec idempotency", () => {
  it("creates, then reports unchanged without churning timestamps", async () => {
    const store = new ScheduleStore(root);
    const first = await upsertSpec(store, "x", cronSpec(), NOW);
    expect(first.status).toBe("created");
    expect(first.job.createdAt).toBe(NOW.toISOString());

    const later = new Date("2026-06-19T00:00:00Z");
    const again = await upsertSpec(store, "x", cronSpec(), later);
    expect(again.status).toBe("unchanged");
    expect(again.job.updatedAt).toBe(NOW.toISOString()); // not bumped to `later`
  });

  it("updates a changed spec, preserving createdAt and runtime fields", async () => {
    const store = new ScheduleStore(root);
    await upsertSpec(store, "x", cronSpec(), NOW);
    // Simulate the daemon having run it once.
    const ran = (await store.get("x"))!;
    ran.lastRunAt = "2026-06-18T09:00:00Z";
    ran.lastResult = "done";
    await store.save(ran);

    const later = new Date("2026-06-20T00:00:00Z");
    const upd = await upsertSpec(
      store,
      "x",
      cronSpec({ prompt: "new prompt" }),
      later,
    );
    expect(upd.status).toBe("updated");
    expect(upd.job.createdAt).toBe(NOW.toISOString()); // preserved
    expect(upd.job.updatedAt).toBe(later.toISOString()); // bumped
    expect(upd.job.lastResult).toBe("done"); // runtime state preserved
  });

  it("sets nextRunAt to the `at` value for one-shot jobs, undefined for cron", async () => {
    const store = new ScheduleStore(root);
    const at = await upsertSpec(
      store,
      "once",
      cronSpec({ cron: undefined, at: "2026-12-25T09:00:00Z" }),
      NOW,
    );
    expect(at.job.nextRunAt).toBe("2026-12-25T09:00:00Z");

    const cron = await upsertSpec(store, "daily", cronSpec(), NOW);
    expect(cron.job.nextRunAt).toBeUndefined();
  });
});
