/**
 * Schedule store + spec helpers — the authoring half of the scheduling
 * initiative. A `ScheduleStore` persists one JSON job spec per file under a
 * `ScopedFs` root; the schedule tools write to it and the (Phase 2) scheduler
 * daemon reads from it and fires the jobs. Nothing in this file executes a job —
 * it only records intent. A plugin has no way to run on a timer; the daemon does.
 *
 * Cron is *validated* here (dependency-free), not parsed: computing the next
 * fire time is the daemon's job (it can take a `cron-parser` dep — a plugin
 * bundle cannot). `at` (one-shot) jobs get a trivial `nextRunAt` of the `at`
 * value.
 */
import { ScopedFs } from "../fs/index";

export interface ScheduleJob {
  /** Filesystem-safe id; the file is `<subdir>/<id>.json`. */
  id: string;
  name: string;
  /** A cron expression (5 or 6 fields). Exactly one of cron/at is set. */
  cron?: string;
  /** A one-shot ISO-8601 datetime. Exactly one of cron/at is set. */
  at?: string;
  /** IANA timezone the cron schedule is evaluated in. */
  timezone: string;
  /** The natural-language task the runner will `.act()` when the job fires. */
  prompt: string;
  /** Optional model id the runner should load for this job. */
  model?: string;
  /** Optional tool-group names the runner should enable for this job. */
  tools?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set by the runner after a fire (runtime state, not user-authored). */
  lastRunAt?: string;
  lastResult?: string;
  /** Next fire: `at` jobs = the `at` value; cron jobs are filled by the daemon. */
  nextRunAt?: string;
  /** Set by run_schedule_now; the daemon fires once then clears it. */
  runRequestedAt?: string;
}

/** The user-authored fields that define a job (vs. runtime/bookkeeping fields). */
export type ScheduleSpec = Pick<
  ScheduleJob,
  "name" | "cron" | "at" | "timezone" | "prompt" | "model" | "tools" | "enabled"
>;

/** A filesystem-safe id derived from a name (first few words). */
export function toScheduleId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-")
    .slice(0, 60);
  return slug || "job";
}

// Cron field ranges: [min, max] per position, for the 5- and 6-field forms.
const CRON_FIELDS_5: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 = Sunday)
];
const CRON_FIELDS_6: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // second
  ...CRON_FIELDS_5,
];

/** Validate one cron field token (`*`, `a`, `a-b`, lists, and `/step`). */
function validateCronField(field: string, min: number, max: number): boolean {
  for (const part of field.split(",")) {
    if (part === "") return false;
    const segs = part.split("/");
    if (segs.length > 2) return false;
    const range = segs[0] ?? "";
    const step = segs[1];
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) === 0)) {
      return false;
    }
    if (range === "*") continue;
    const m = range.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return false;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    if (lo < min || hi > max || lo > hi) return false;
  }
  return true;
}

/**
 * Validate a cron expression structurally (5 or 6 whitespace-separated fields,
 * `*`/numbers/ranges/lists/steps within each field's range). Not a parser — it
 * does not compute fire times, only rejects garbage at authoring time. Month and
 * day-of-week names (JAN, MON) are not supported yet; use numbers.
 */
export function validateCron(
  expr: string,
): { ok: true } | { ok: false; reason: string } {
  const fields = expr.trim().split(/\s+/).filter(Boolean);
  const spec =
    fields.length === 5
      ? CRON_FIELDS_5
      : fields.length === 6
        ? CRON_FIELDS_6
        : null;
  if (!spec) {
    return {
      ok: false,
      reason: `expected 5 or 6 fields, got ${fields.length} ("${expr.trim()}")`,
    };
  }
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    const bounds = spec[i];
    if (!bounds) continue;
    if (!validateCronField(field, bounds[0], bounds[1])) {
      return {
        ok: false,
        reason: `invalid cron field "${field}" at position ${i + 1}`,
      };
    }
  }
  return { ok: true };
}

/** Canonical serialization of the authored fields, for equality checks. */
function normalizeSpec(s: ScheduleSpec): string {
  return JSON.stringify({
    name: s.name,
    cron: s.cron ?? null,
    at: s.at ?? null,
    timezone: s.timezone,
    prompt: s.prompt,
    model: s.model ?? null,
    tools: s.tools ?? null,
    enabled: s.enabled,
  });
}

/** True when two specs have identical user-authored fields. */
export function specEquals(a: ScheduleSpec, b: ScheduleSpec): boolean {
  return normalizeSpec(a) === normalizeSpec(b);
}

export class ScheduleStore {
  private readonly fs: ScopedFs;
  private readonly subdir: string;

  constructor(root: string, subdir = "schedules") {
    this.fs = new ScopedFs(root);
    this.subdir = subdir.replace(/\/+$/, "") || "schedules";
  }

  private rel(id: string): string {
    return `${this.subdir}/${id}.json`;
  }

  async get(id: string): Promise<ScheduleJob | null> {
    const raw = await this.fs.readFileFull(this.rel(id)).catch(() => null);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ScheduleJob;
    } catch {
      return null; // corrupt file → treat as absent
    }
  }

  async exists(id: string): Promise<boolean> {
    return this.fs.exists(this.rel(id));
  }

  async list(): Promise<ScheduleJob[]> {
    if (!(await this.fs.exists(this.subdir))) return [];
    const jobs: ScheduleJob[] = [];
    for (const entry of await this.fs.list(this.subdir)) {
      if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
      const raw = await this.fs
        .readFileFull(`${this.subdir}/${entry.name}`)
        .catch(() => null);
      if (raw === null) continue;
      try {
        jobs.push(JSON.parse(raw) as ScheduleJob);
      } catch {
        continue; // skip a corrupt file rather than failing the whole list
      }
    }
    jobs.sort((a, b) => a.id.localeCompare(b.id));
    return jobs;
  }

  /** Write the job atomically; returns false if it was already identical. */
  async save(job: ScheduleJob): Promise<boolean> {
    return this.fs.writeFileIfChanged(
      this.rel(job.id),
      JSON.stringify(job, null, 2) + "\n",
    );
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.fs.exists(this.rel(id)))) return false;
    await this.fs.remove(this.rel(id));
    return true;
  }
}

export type UpsertStatus = "created" | "updated" | "unchanged";

/**
 * Create or update the job at `id` from `spec`. Idempotent: if a job with the
 * same authored fields already exists, it is left untouched (no timestamp
 * churn) and reported "unchanged" — so re-issuing the same schedule_task is a
 * free no-op, the same loop-breaking contract as the write tools. `createdAt`
 * and the runtime fields (lastRun/lastResult/runRequestedAt) are preserved
 * across an update; `nextRunAt` is reset to the `at` value (the daemon
 * recomputes it for cron jobs).
 */
export async function upsertSpec(
  store: ScheduleStore,
  id: string,
  spec: ScheduleSpec,
  now: Date,
): Promise<{ status: UpsertStatus; job: ScheduleJob }> {
  const existing = await store.get(id);
  if (existing && specEquals(existing, spec)) {
    return { status: "unchanged", job: existing };
  }
  const iso = now.toISOString();
  const job: ScheduleJob = {
    id,
    ...spec,
    createdAt: existing?.createdAt ?? iso,
    updatedAt: iso,
    lastRunAt: existing?.lastRunAt,
    lastResult: existing?.lastResult,
    nextRunAt: spec.at, // `at` → that instant; cron → undefined (daemon fills)
    runRequestedAt: existing?.runRequestedAt,
  };
  await store.save(job);
  return { status: existing ? "updated" : "created", job };
}
