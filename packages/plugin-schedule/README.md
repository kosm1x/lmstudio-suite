# schedule

Let a local model **author scheduled tasks** — recurring (cron) or one-shot — that an external scheduler daemon runs later. This is the authoring half of the suite's scheduling story; **it records jobs, it does not run them.**

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

> ⚠️ **An LM Studio plugin has no way to run on a timer** — its code only executes while the model is responding. So this plugin writes job specs to a directory; a companion **scheduler daemon** (run on the same machine) reads that directory and fires the jobs via an agentic run. Without the daemon running, schedules are recorded but never execute.

## Tools

| Tool               | What it does                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `schedule_task`    | Create/update a task — `cron` (recurring) or `at` (one-shot ISO datetime) + a natural-language prompt. |
| `list_schedules`   | List saved tasks with timing, enabled state, last/next run.                                            |
| `cancel_schedule`  | Delete a task by id.                                                                                   |
| `update_schedule`  | Change a task's timing, prompt, timezone, model, tools, or enabled state.                              |
| `run_schedule_now` | Request an immediate run on the daemon's next poll (for testing).                                      |

## Configuration

- **Schedule directory** — absolute path (supports `~`) where job specs are stored as JSON. **The scheduler daemon must read this same directory.** Leave blank to disable the plugin.
- **Default timezone** — IANA name (e.g. `America/Mexico_City`) used for cron schedules when none is given. Blank = this machine's timezone.
- **Enable schedule tools** — toggle the five tools (on by default; still requires the directory).

## Notes

- A job is stored as `<schedule dir>/schedules/<id>.json`. The id is derived from the task name (or set explicitly); re-running `schedule_task` with the same name **updates in place** rather than creating duplicates, and an identical re-run is a no-op.
- Cron is **validated** (5 or 6 fields, ranges/lists/steps) but not parsed here — the daemon computes fire times. Month/day-of-week names (`JAN`, `MON`) are not supported yet; use numbers.

MIT licensed.
