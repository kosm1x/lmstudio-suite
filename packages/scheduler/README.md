# scheduler

The daemon that makes the `schedule` plugin real. It reads the job specs the schedule tools write and **fires due jobs against LM Studio on time**, via an agentic `.act()` run.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

> **Why a separate process?** An LM Studio plugin's code only runs while the model is responding — there's no background timer. So scheduling splits: the `schedule` plugin/tools **author** jobs; this daemon **executes** them. Run it on the same machine as LM Studio and keep it alive (launchd / pm2).

## Run it

```bash
# LM Studio must be running with its local server on and a tool-capable model loaded.
npm start -w @lmstudio-suite/scheduler -- --dir ~/.lmstudio-suite/schedules
# or: npx tsx packages/scheduler/src/main.ts --dir <schedule dir>
```

Point `--dir` at the **same** directory the `schedule` plugin's _Schedule directory_ config (or `agent-cli --schedule`) writes to.

| Option           | Default        | Meaning                                                              |
| ---------------- | -------------- | -------------------------------------------------------------------- |
| `--dir <path>`   | (required)     | Schedule directory (reads `<dir>/schedules/*.json`).                 |
| `--poll <sec>`   | `30`           | Poll interval.                                                       |
| `--cwd <path>`   | `<dir>/work`   | Working dir for jobs' fs/data tools (a subdir, not the spec dir).    |
| `--model <id>`   | loaded model   | Default model for jobs that don't set one.                           |
| `--tz <zone>`    | this machine's | Default IANA timezone.                                               |
| `--max-rounds n` | `8`            | Max agentic rounds per job.                                          |
| `--kb <path>`    | off            | Also write each run result into this KB dir as a kb-map node.        |
| `--allow-shell`  | off            | Let jobs requesting the `shell` group run `run_shell` (unsandboxed). |

Env fallbacks: `SCHEDULE_DIR`, `SCHEDULE_POLL_SEC`, `SCHEDULE_CWD`, `SCHEDULE_MODEL`, `SCHEDULE_TZ`, `SCHEDULE_KB`, `SCHEDULE_ALLOW_SHELL`.

> **Safety:** `--cwd` defaults to a `work/` subdir so a job's filesystem tools can't read or rewrite the schedule specs. The `shell` group is gated behind `--allow-shell` (off by default) — an unattended daemon shouldn't run arbitrary shell on the model's say-so unless you trust every scheduled job.

## What a fired job does

For each due job it loads the job's model (or the default), composes the tool groups named in the job's `tools` (default: `time`, `fs`, `data`, `web`) scoped to `--cwd`, prepends the current date/time, runs `.act(prompt)`, and writes a run log to `<dir>/runs/<id>/<timestamp>.md`. The job's `lastRunAt`/`lastResult` are updated so `list_schedules` shows the outcome.

With `--kb <dir>`, each successful result is **also** written into that knowledge base as a kb-map node (`scheduled/<id>-<ts>.md`, with frontmatter), so past run outputs become navigable/retrievable via the `kb-map` plugin or the `memory` RAG over the same dir. The KB write is best-effort — a failure there never marks the run failed.

## Behavior

- **Due** = a cron occurrence has passed since `lastRunAt` (or `createdAt` if never run), OR a one-shot `at` time has passed, OR `run_schedule_now` set `runRequestedAt`.
- **Catch-up collapses:** occurrences missed while the daemon was down fire **once**, then the schedule advances to the next future occurrence — no backlog stampede.
- **One-shot `at` jobs disable** themselves after firing (success or failure). **Cron jobs stay enabled** and a failure is recorded in `lastResult` without retrying until the next occurrence (no retry storm).
- **Crash-safe (at-least-once):** state lives in the job files, so a normal restart never re-fires an occurrence it already recorded. If the process is killed mid-tick (after the `.act()` ran but before the result was saved), that occurrence may fire again on restart — at-least-once, the right tradeoff for jobs with side effects.
- **Resilient:** one job's failure (or LM Studio being down) never stops the loop.

## Keep it alive (macOS)

Use a launchd plist or `pm2 start "npm start -w @lmstudio-suite/scheduler -- --dir <dir>"`. The daemon shuts down cleanly on SIGINT/SIGTERM after the current tick.

MIT licensed.
