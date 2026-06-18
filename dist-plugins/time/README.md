# time

Give a local model a sense of **now**. LLMs are reliably wrong about today's date, relative dates ("next Tuesday", "in 3 days"), and timezone math — this plugin removes that whole class of mistake.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Two halves

- **Date/time injection** (prompt preprocessor) — prepends one line to each message, e.g.
  `Current date and time: Thursday, June 18, 2026, 2:30:05 PM CST (timezone America/Mexico_City; ISO-8601 2026-06-18T14:30:05-06:00).`
  so the model always knows the current moment without a tool call.
- **Date/time tools** (tools provider) — for exact computation when the model needs it.

## Tools

| Tool               | What it does                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `now`              | Current date/time in any IANA zone. Formats: `iso`, `human`, `date`, `time`, `unix`.             |
| `time_until`       | How far a target is from now as a phrase — `in 3 days, 4 hours` / `2 hours ago`.                 |
| `add_duration`     | Add/subtract a duration (seconds…years); months/years are calendar-aware and clamp end-of-month. |
| `diff_dates`       | Difference between two datetimes — a human phrase (`auto`) or the exact number in a fixed unit.  |
| `convert_timezone` | Convert a datetime between zones; pass `from` to anchor an offset-less wall time.                |

## Configuration

- **Default timezone** — IANA name (e.g. `America/Mexico_City`) used by the injection and the tools when none is passed. Leave blank to use this machine's timezone.
- **Inject current date/time** — toggle the always-on date line (on by default).
- **Expose date/time tools** — toggle the five tools (on by default).

## Notes

- All timezone handling uses the built-in `Intl` API: IANA zones, DST-aware, no dependency.
- Pass datetimes as ISO-8601. Include a `Z`/offset for an unambiguous instant — an offset-less datetime is read as local time per the ECMAScript spec (except in `convert_timezone`, where `from` overrides this).
- The injection never blocks a message: a bad timezone config passes the message through unchanged.

MIT licensed.
