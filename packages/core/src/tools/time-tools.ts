/**
 * SDK `tool()` builders for date/time — the callable half of the `time`
 * capability (the always-on "current date/time" line is the plugin's
 * preprocessor). The point mirrors the data tools: stop the model guessing at
 * today's date, relative dates ("in 3 days"), and timezone math — give it
 * exact, DST-correct answers.
 *
 * All timezone work uses the built-in `Intl` API, so there is no dependency.
 * The clock is injectable (`options.now`) so `now`/`time_until` are testable;
 * every other tool is already pure (it operates on its arguments).
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import {
  formatInstant,
  parseDate,
  addDuration,
  humanizeDuration,
  zonedWallTimeToInstant,
  hostTimezone,
  UNIT_MS,
  HAS_OFFSET,
  type TimeFormat,
  type DurationUnit,
} from "../time/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export interface TimeToolsOptions {
  /** Clock source (tests inject a fixed one; default `() => new Date()`). */
  now?: () => Date;
  /** Default IANA timezone for tools when none is passed (default: host zone). */
  defaultTimezone?: string;
}

const FORMATS = ["iso", "human", "date", "time", "unix"] as const;
const ADD_UNITS = [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
] as const;
const DIFF_UNITS = [
  "auto",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
] as const;

/** Round a unit difference to a tidy 3 decimal places (drops trailing zeros). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function createTimeTools(options: TimeToolsOptions = {}): Tool[] {
  const now = options.now ?? (() => new Date());
  const defaultTz = options.defaultTimezone?.trim()
    ? options.defaultTimezone.trim()
    : hostTimezone();

  return [
    tool({
      name: "now",
      description:
        "Get the current date and time. Use this whenever you need to know what " +
        "'today', 'now', or the current year/time is — do not guess it. Returns the " +
        `time in the configured zone (${defaultTz}) unless you pass another. Formats: ` +
        "iso (machine-readable with offset), human, date, time, unix (epoch seconds).",
      parameters: {
        timezone: z
          .string()
          .optional()
          .describe(
            `IANA timezone, e.g. 'America/Mexico_City' or 'UTC'. Default: ${defaultTz}.`,
          ),
        format: z
          .enum(FORMATS)
          .default("human")
          .describe("Output format. Default 'human'."),
      },
      implementation: async ({ timezone, format }, { status }) => {
        status("now");
        try {
          return formatInstant(now(), {
            timezone: timezone?.trim() || defaultTz,
            format: format as TimeFormat,
          });
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "time_until",
      description:
        "Compute how far a target date/time is from now, as a human phrase like " +
        "'in 3 days, 4 hours' or '2 hours ago'. Use for deadlines, countdowns, or " +
        "'how long until X'. Give the target as ISO-8601 (include a Z/offset to be exact).",
      parameters: {
        target: z
          .string()
          .describe(
            "Target datetime, ISO-8601, e.g. '2026-12-25' or '2026-06-20T09:00:00Z'.",
          ),
      },
      implementation: async ({ target }, { status }) => {
        status("time_until");
        try {
          const ms = parseDate(target).getTime() - now().getTime();
          if (Math.abs(ms) < 1000) return "now (less than a second away)";
          const span = humanizeDuration(ms);
          return ms > 0 ? `in ${span}` : `${span} ago`;
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "add_duration",
      description:
        "Add (or subtract, with a negative amount) a duration to a date/time and return " +
        "the result as ISO-8601. Use for 'what date is 90 days from X', scheduling, " +
        "expiry math. months/years use calendar math and clamp end-of-month (Jan 31 + " +
        "1 month → Feb 28).",
      parameters: {
        datetime: z
          .string()
          .describe("Starting datetime, ISO-8601 (or unix seconds)."),
        amount: z
          .number()
          .describe("How many units to add; negative subtracts."),
        unit: z
          .enum(ADD_UNITS)
          .describe(
            "Unit of the amount (whole numbers only for months/years).",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            `IANA timezone for the returned ISO string. Default: ${defaultTz}.`,
          ),
      },
      implementation: async (
        { datetime, amount, unit, timezone },
        { status },
      ) => {
        status("add_duration");
        try {
          const result = addDuration(
            parseDate(datetime),
            amount,
            unit as DurationUnit,
          );
          return formatInstant(result, {
            timezone: timezone?.trim() || defaultTz,
            format: "iso",
          });
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "diff_dates",
      description:
        "Difference between two datetimes. With unit 'auto' (default) returns a human " +
        "phrase like '3 days, 4 hours later'; with a fixed unit (seconds…weeks) returns " +
        "the exact numeric difference (to − from) in that unit. Include Z/offsets for exactness.",
      parameters: {
        from: z
          .string()
          .describe("Start datetime, ISO-8601 (or unix seconds)."),
        to: z.string().describe("End datetime, ISO-8601 (or unix seconds)."),
        unit: z
          .enum(DIFF_UNITS)
          .default("auto")
          .describe(
            "'auto' for a human phrase, or seconds/minutes/hours/days/weeks.",
          ),
      },
      implementation: async ({ from, to, unit }, { status }) => {
        status("diff_dates");
        try {
          const ms = parseDate(to).getTime() - parseDate(from).getTime();
          if (unit === "auto") {
            if (ms === 0) return "the same instant";
            return `${humanizeDuration(ms)} ${ms > 0 ? "later" : "earlier"}`;
          }
          return String(round3(ms / UNIT_MS[unit as keyof typeof UNIT_MS]));
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),

    tool({
      name: "convert_timezone",
      description:
        "Convert a datetime from one timezone to another. If the input has a Z/offset it " +
        "is an exact instant and 'from' is ignored; if it is an offset-less wall time, " +
        "pass 'from' to say which zone it is in (otherwise it is read as UTC). Returns the " +
        "time in the target zone (human + ISO).",
      parameters: {
        datetime: z
          .string()
          .describe(
            "Datetime to convert, e.g. '2026-06-18 14:00' or '2026-06-18T20:00:00Z'.",
          ),
        to: z.string().describe("Target IANA timezone, e.g. 'Asia/Tokyo'."),
        from: z
          .string()
          .optional()
          .describe(
            "Source IANA timezone for an offset-less input (default: UTC).",
          ),
      },
      implementation: async ({ datetime, to, from }, { status }) => {
        status("convert_timezone");
        try {
          const absolute = HAS_OFFSET.test(datetime.trim());
          const instant = absolute
            ? parseDate(datetime)
            : zonedWallTimeToInstant(datetime, from?.trim() || "UTC");
          const human = formatInstant(instant, {
            timezone: to,
            format: "human",
          });
          const iso = formatInstant(instant, { timezone: to, format: "iso" });
          const note =
            !absolute && !from?.trim()
              ? " (input read as UTC; pass 'from' to set its source zone)"
              : "";
          return `${human}\nISO: ${iso}${note}`;
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),
  ];
}
