// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-schedule. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/fs/scoped-fs.ts
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
var DEFAULT_IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules"
]);
var PathEscapeError = class extends Error {
  constructor(p) {
    super(`Path escapes the allowed root directory: ${p}`);
    this.name = "PathEscapeError";
  }
};
var ScopedFs = class {
  /** Absolute, resolved root directory. */
  root;
  maxReadBytes;
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.maxReadBytes = options.maxReadBytes ?? 1e6;
  }
  /** Resolve a relative path within the root, throwing if it would escape. */
  resolvePath(relPath) {
    const target = resolve(this.root, relPath);
    const rel = relative(this.root, target);
    if (rel === "") return target;
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }
  async readFile(relPath) {
    const p = this.resolvePath(relPath);
    const stat = await fsp.stat(p);
    if (stat.size <= this.maxReadBytes) return fsp.readFile(p, "utf-8");
    const fh = await fsp.open(p, "r");
    try {
      const buf = Buffer.alloc(this.maxReadBytes);
      const { bytesRead } = await fh.read(buf, 0, this.maxReadBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf-8") + "\n\u2026[truncated]";
    } finally {
      await fh.close();
    }
  }
  /**
   * Read the entire file with no truncation cap. Use for edit/transform
   * operations, where writing back a model-facing (size-capped) read would
   * silently drop everything past the cap. `readFile` is the capped read.
   */
  async readFileFull(relPath) {
    return fsp.readFile(this.resolvePath(relPath), "utf-8");
  }
  /**
   * Write a file, creating parent directories as needed.
   *
   * Atomic: the content is staged to a sibling temp file and renamed into
   * place, so a crash mid-write leaves the temp file rather than a truncated
   * original. (rename is atomic within a filesystem; the temp sits in the same
   * directory as the target, hence the same filesystem.) This matters for
   * `edit_file`, where a partial write would corrupt existing content.
   */
  async writeFile(relPath, content) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /**
   * Atomic write that skips the write entirely when the file already holds
   * exactly `content`. Returns `true` if it wrote, `false` if the file was
   * already identical. Compares against the FULL existing content (not the
   * truncated read), so an over-cap but unchanged file is still detected as a
   * no-op. Lets a write tool report "already saved" instead of redoing an
   * expensive write — and gives a looping model a clear terminal signal.
   */
  async writeFileIfChanged(relPath, content) {
    const existing = await this.readFileFull(relPath).catch(() => null);
    if (existing === content) return false;
    await this.writeFile(relPath, content);
    return true;
  }
  /** Atomically write raw bytes (e.g. a downloaded file). Same temp+rename. */
  async writeBytes(relPath, data) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /** Move/rename a file within the root; both ends are traversal-guarded. */
  async move(fromRel, toRel) {
    const from = this.resolvePath(fromRel);
    const to = this.resolvePath(toRel);
    await fsp.mkdir(dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }
  async list(relPath = ".") {
    const p = this.resolvePath(relPath);
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map(
      (e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other"
      })
    ).sort((a, b) => a.name.localeCompare(b.name));
  }
  async exists(relPath) {
    try {
      await fsp.stat(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }
  /** Type + size + mtime for a path. Throws (ENOENT) if it does not exist. */
  async stat(relPath) {
    const s = await fsp.stat(this.resolvePath(relPath));
    return {
      type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
      size: s.size,
      mtimeMs: s.mtimeMs
    };
  }
  /**
   * Recursively yield file paths (relative to root, POSIX-separated `/`) under
   * `relPath`. Yields files only; directories whose name is in `ignore` are
   * pruned. Symlinks are not followed, and unreadable directories are skipped
   * rather than throwing. Iteration order is unspecified — sort if you need it.
   */
  async *walk(relPath = ".", options = {}) {
    const ignore = options.ignore ?? DEFAULT_IGNORE_DIRS;
    const stack = [this.resolvePath(relPath)];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (!ignore.has(e.name)) stack.push(abs);
        } else if (e.isFile()) {
          yield relative(this.root, abs).split(sep).join("/");
        }
      }
    }
  }
  async mkdir(relPath) {
    await fsp.mkdir(this.resolvePath(relPath), { recursive: true });
  }
  /** Remove a file or directory. Refuses to remove the root itself. */
  async remove(relPath) {
    const p = this.resolvePath(relPath);
    if (p === this.root)
      throw new Error("Refusing to remove the root directory.");
    await fsp.rm(p, { recursive: true, force: true });
  }
};

// packages/core/src/time/time.ts
function hostTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
function assertTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(
      `unknown timezone: "${tz}" (use an IANA name like "America/Mexico_City" or "UTC")`
    );
  }
}
function parseDate(input) {
  const s = input.trim();
  if (/^\d{9,10}$/.test(s)) return new Date(Number(s) * 1e3);
  if (/^\d+$/.test(s)) {
    throw new Error(
      `ambiguous numeric date: "${input}" (use ISO-8601 like 2026-06-18, or unix seconds as a 10-digit number)`
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `cannot parse date/time: "${input}" (use ISO-8601 like 2026-06-18 or 2026-06-18T14:30:00Z, or unix seconds)`
    );
  }
  return d;
}

// packages/core/src/schedule/schedule.ts
function toScheduleId(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 8).join("-").slice(0, 60);
  return slug || "job";
}
var CRON_FIELDS_5 = [
  [0, 59],
  // minute
  [0, 23],
  // hour
  [1, 31],
  // day of month
  [1, 12],
  // month
  [0, 7]
  // day of week (0 and 7 = Sunday)
];
var CRON_FIELDS_6 = [
  [0, 59],
  // second
  ...CRON_FIELDS_5
];
function validateCronField(field, min, max) {
  for (const part of field.split(",")) {
    if (part === "") return false;
    const segs = part.split("/");
    if (segs.length > 2) return false;
    const range = segs[0] ?? "";
    const step = segs[1];
    if (step !== void 0 && (!/^\d+$/.test(step) || Number(step) === 0)) {
      return false;
    }
    if (range === "*") continue;
    const m = range.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return false;
    const lo = Number(m[1]);
    const hi = m[2] !== void 0 ? Number(m[2]) : lo;
    if (lo < min || hi > max || lo > hi) return false;
  }
  return true;
}
function validateCron(expr) {
  const fields = expr.trim().split(/\s+/).filter(Boolean);
  const spec = fields.length === 5 ? CRON_FIELDS_5 : fields.length === 6 ? CRON_FIELDS_6 : null;
  if (!spec) {
    return {
      ok: false,
      reason: `expected 5 or 6 fields, got ${fields.length} ("${expr.trim()}")`
    };
  }
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    const bounds = spec[i];
    if (!bounds) continue;
    if (!validateCronField(field, bounds[0], bounds[1])) {
      return {
        ok: false,
        reason: `invalid cron field "${field}" at position ${i + 1}`
      };
    }
  }
  return { ok: true };
}
function normalizeSpec(s) {
  return JSON.stringify({
    name: s.name,
    cron: s.cron ?? null,
    at: s.at ?? null,
    timezone: s.timezone,
    prompt: s.prompt,
    model: s.model ?? null,
    tools: s.tools ?? null,
    enabled: s.enabled
  });
}
function specEquals(a, b) {
  return normalizeSpec(a) === normalizeSpec(b);
}
var ScheduleStore = class {
  fs;
  subdir;
  constructor(root, subdir = "schedules") {
    this.fs = new ScopedFs(root);
    this.subdir = subdir.replace(/\/+$/, "") || "schedules";
  }
  rel(id) {
    return `${this.subdir}/${id}.json`;
  }
  async get(id) {
    const raw = await this.fs.readFileFull(this.rel(id)).catch(() => null);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async exists(id) {
    return this.fs.exists(this.rel(id));
  }
  async list() {
    if (!await this.fs.exists(this.subdir)) return [];
    const jobs = [];
    for (const entry of await this.fs.list(this.subdir)) {
      if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
      const raw = await this.fs.readFileFull(`${this.subdir}/${entry.name}`).catch(() => null);
      if (raw === null) continue;
      try {
        jobs.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }
    jobs.sort((a, b) => a.id.localeCompare(b.id));
    return jobs;
  }
  /** Write the job atomically; returns false if it was already identical. */
  async save(job) {
    return this.fs.writeFileIfChanged(
      this.rel(job.id),
      JSON.stringify(job, null, 2) + "\n"
    );
  }
  async remove(id) {
    if (!await this.fs.exists(this.rel(id))) return false;
    await this.fs.remove(this.rel(id));
    return true;
  }
};
async function upsertSpec(store, id, spec, now) {
  const existing = await store.get(id);
  if (existing && specEquals(existing, spec)) {
    return { status: "unchanged", job: existing };
  }
  const iso = now.toISOString();
  const job = {
    id,
    ...spec,
    createdAt: existing?.createdAt ?? iso,
    updatedAt: iso,
    lastRunAt: existing?.lastRunAt,
    lastResult: existing?.lastResult,
    nextRunAt: spec.at,
    // `at` → that instant; cron → undefined (daemon fills)
    runRequestedAt: existing?.runRequestedAt
  };
  await store.save(job);
  return { status: existing ? "updated" : "created", job };
}

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/http-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool3 } from "@lmstudio/sdk";
import { z as z3 } from "zod";

// packages/core/src/tools/map-tools.ts
import { tool as tool4 } from "@lmstudio/sdk";
import { z as z4 } from "zod";

// packages/core/src/tools/data-tools.ts
import { tool as tool5 } from "@lmstudio/sdk";
import { z as z5 } from "zod";

// packages/core/src/tools/memory-tools.ts
import { tool as tool6 } from "@lmstudio/sdk";
import { z as z6 } from "zod";

// packages/core/src/tools/time-tools.ts
import { tool as tool7 } from "@lmstudio/sdk";
import { z as z7 } from "zod";

// packages/core/src/tools/schedule-tools.ts
import { tool as tool8 } from "@lmstudio/sdk";
import { z as z8 } from "zod";
var msg = (err) => err instanceof Error ? err.message : String(err);
var DAEMON_NOTE = "Note: scheduled jobs only run while the scheduler daemon is running \u2014 this records the job, it does not execute it.";
function formatJob(job) {
  const when = job.cron ? `cron "${job.cron}"` : `at ${job.at}`;
  const state = job.enabled ? "enabled" : "disabled";
  const last = job.lastRunAt ? ` | last run ${job.lastRunAt}` : "";
  const next = job.nextRunAt ? ` | next ${job.nextRunAt}` : "";
  const pending = job.runRequestedAt ? " | run requested" : "";
  return `[${job.id}] ${job.name} \u2014 ${when} (${job.timezone}), ${state}${next}${last}${pending}`;
}
function createScheduleTools(options) {
  const store = new ScheduleStore(options.root, options.subdir);
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const defaultTz = options.defaultTimezone?.trim() ? options.defaultTimezone.trim() : hostTimezone();
  function validateTiming(cron, at, timezone) {
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
    tool8({
      name: "schedule_task",
      description: "Schedule a task to run later \u2014 either on a recurring cron schedule or once at a specific time. The task is a natural-language instruction the agent will carry out when it fires. Re-running with the same name updates that schedule in place. " + DAEMON_NOTE,
      parameters: {
        name: z8.string().describe(
          "Short name for the schedule (also its id), e.g. 'morning briefing'."
        ),
        prompt: z8.string().describe("The task to perform when it fires, in plain language."),
        cron: z8.string().optional().describe(
          "Cron expression (5 or 6 fields), e.g. '0 9 * * *' for 9am daily."
        ),
        at: z8.string().optional().describe(
          "One-shot ISO-8601 datetime, e.g. '2026-12-25T09:00:00Z'. Use instead of cron."
        ),
        timezone: z8.string().optional().describe(
          `IANA timezone for a cron schedule. Default: ${defaultTz}.`
        ),
        model: z8.string().optional().describe(
          "Optional model id the run should use (default: the loaded model)."
        ),
        tools: z8.array(z8.string()).optional().describe(
          "Optional tool groups the run should enable (e.g. ['web','fs'])."
        ),
        id: z8.string().optional().describe(
          "Explicit id to create/overwrite. Omit to derive it from the name."
        )
      },
      implementation: async ({ name, prompt, cron, at, timezone, model, tools, id }, { status, warn }) => {
        status("schedule_task");
        if (!name.trim()) return "Error: name must not be empty.";
        if (!prompt.trim()) return "Error: prompt must not be empty.";
        const tz = timezone?.trim() || defaultTz;
        const bad = validateTiming(cron, at, tz);
        if (bad) return `Error: ${bad}.`;
        try {
          const spec = {
            name: name.trim(),
            cron,
            at,
            timezone: tz,
            prompt: prompt.trim(),
            model,
            tools,
            enabled: true
          };
          const jobId = toScheduleId(id?.trim() || name);
          const { status: st, job } = await upsertSpec(
            store,
            jobId,
            spec,
            now()
          );
          const past = at && parseDate(at).getTime() < now().getTime() ? " WARNING: that time is in the past and will not fire." : "";
          if (st === "unchanged")
            return `Already scheduled as "${job.id}" \u2014 unchanged. ${DAEMON_NOTE}`;
          return `${st === "created" ? "Scheduled" : "Updated"} "${job.id}": ${formatJob(job)}.${past}
${DAEMON_NOTE}`;
        } catch (err) {
          warn(`schedule_task failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool8({
      name: "list_schedules",
      description: "List saved scheduled tasks with their timing, enabled state, and last/next run. Use to see what is scheduled or to find an id to update or cancel.",
      parameters: {
        enabled_only: z8.boolean().default(false).describe("Only show enabled schedules.")
      },
      implementation: async ({ enabled_only }, { status, warn }) => {
        status("list_schedules");
        try {
          let jobs = await store.list();
          if (enabled_only) jobs = jobs.filter((j) => j.enabled);
          if (jobs.length === 0) return "No schedules.";
          return `${jobs.map(formatJob).join("\n")}

${DAEMON_NOTE}`;
        } catch (err) {
          warn(`list_schedules failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool8({
      name: "cancel_schedule",
      description: "Delete a scheduled task by its id (use list_schedules to find it). Irreversible.",
      parameters: {
        id: z8.string().describe("The id of the schedule to cancel.")
      },
      implementation: async ({ id }, { status, warn }) => {
        status("cancel_schedule");
        try {
          const safeId = toScheduleId(id);
          const removed = await store.remove(safeId);
          return removed ? `Cancelled "${safeId}".` : `No schedule with id "${id}". Use list_schedules to see ids.`;
        } catch (err) {
          warn(`cancel_schedule failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool8({
      name: "update_schedule",
      description: "Change fields of an existing schedule (its timing, prompt, timezone, model, tools, or enable/disable it). Only the fields you pass change. Switch timing by passing the new cron OR at (the other is cleared).",
      parameters: {
        id: z8.string().describe("The id of the schedule to update."),
        name: z8.string().optional().describe("New display name."),
        prompt: z8.string().optional().describe("New task instruction."),
        cron: z8.string().optional().describe("New cron expression (clears any `at`)."),
        at: z8.string().optional().describe("New one-shot datetime (clears any cron)."),
        timezone: z8.string().optional().describe("New IANA timezone."),
        model: z8.string().optional().describe("New model id."),
        tools: z8.array(z8.string()).optional().describe("New tool-group list."),
        enabled: z8.boolean().optional().describe("Enable (true) or disable (false) the schedule.")
      },
      implementation: async ({ id, name, prompt, cron, at, timezone, model, tools, enabled }, { status, warn }) => {
        status("update_schedule");
        try {
          const safeId = toScheduleId(id);
          const existing = await store.get(safeId);
          if (!existing)
            return `No schedule with id "${id}". Use list_schedules to see ids.`;
          if (cron && at) return "Error: provide either cron or at, not both.";
          let nextCron = existing.cron;
          let nextAt = existing.at;
          if (cron) {
            nextCron = cron;
            nextAt = void 0;
          } else if (at) {
            nextAt = at;
            nextCron = void 0;
          }
          const tz = timezone?.trim() || existing.timezone;
          const bad = validateTiming(nextCron, nextAt, tz);
          if (bad) return `Error: ${bad}.`;
          const spec = {
            name: name?.trim() || existing.name,
            cron: nextCron,
            at: nextAt,
            timezone: tz,
            prompt: prompt?.trim() || existing.prompt,
            model: model ?? existing.model,
            tools: tools ?? existing.tools,
            enabled: enabled ?? existing.enabled
          };
          const { status: st, job } = await upsertSpec(
            store,
            safeId,
            spec,
            now()
          );
          return st === "unchanged" ? `No change to "${job.id}".` : `Updated "${job.id}": ${formatJob(job)}.`;
        } catch (err) {
          warn(`update_schedule failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool8({
      name: "run_schedule_now",
      description: "Request that a scheduled task run as soon as possible (on the scheduler's next poll), without waiting for its scheduled time. Useful for testing a schedule. " + DAEMON_NOTE,
      parameters: {
        id: z8.string().describe("The id of the schedule to run now.")
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
      }
    })
  ];
}

// packages/plugin-schedule/src/index.ts
import { homedir } from "node:os";
import { join, resolve as resolve2 } from "node:path";

// packages/plugin-schedule/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var globalConfigSchematics = createConfigSchematics().field(
  "scheduleDir",
  "string",
  {
    displayName: "Schedule directory",
    hint: "Absolute path where scheduled-task specs are stored (supports a leading ~). The scheduler daemon must read this SAME directory. Leave blank to disable.",
    placeholder: "~/.lmstudio-suite/schedules"
  },
  ""
).field(
  "timezone",
  "string",
  {
    displayName: "Default timezone",
    hint: "IANA timezone for cron schedules when none is given (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
    placeholder: "America/Mexico_City"
  },
  ""
).build();
var chatConfigSchematics = createConfigSchematics().field(
  "enableTools",
  "boolean",
  {
    displayName: "Enable schedule tools",
    hint: "Expose schedule_task / list_schedules / cancel_schedule / update_schedule / run_schedule_now. Requires a Schedule directory above. On by default."
  },
  true
).build();

// packages/plugin-schedule/src/index.ts
function expandHome(p) {
  const t = p.trim();
  if (!t) return "";
  const expanded = t === "~" || t.startsWith("~/") ? join(homedir(), t.slice(1)) : t;
  return resolve2(expanded);
}
async function toolsProvider(ctl) {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("scheduleDir"));
  if (!dir || !chat.get("enableTools")) return [];
  const tz = global.get("timezone").trim() || hostTimezone();
  return createScheduleTools({ root: dir, defaultTimezone: tz });
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withToolsProvider(toolsProvider);
}
export {
  main,
  toolsProvider
};
