/**
 * Deterministic date/time helpers — the logic behind the `time` tool group and
 * the date/time line the time plugin / agent CLI inject into the prompt.
 *
 * The point mirrors data-tools: stop the model guessing at "today", relative
 * dates, and timezone math — hand it exact, DST-correct answers instead. All
 * timezone handling uses the built-in `Intl` API (IANA zones, DST-aware), so
 * there is no dependency and nothing for the plugin bundler to flag.
 *
 * "Now" is never read implicitly in this file: every function takes the instant
 * it needs, so all of them are pure and unit-testable. The tool/plugin layer is
 * the only place a real `new Date()` is injected.
 */

export type TimeFormat = "iso" | "human" | "date" | "time" | "unix";

export type DurationUnit =
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

export type DiffUnit =
  | "auto"
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks";

/** Milliseconds per fixed-length unit (months/years are calendar math, not here). */
export const UNIT_MS: Record<
  "seconds" | "minutes" | "hours" | "days" | "weeks",
  number
> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

/** True when a datetime string carries an explicit offset/Z (i.e. is absolute). */
export const HAS_OFFSET = /(?:[zZ])$|[+-]\d{2}:?\d{2}$/;

/** The host's IANA timezone (honours the TZ env var). Falls back to UTC. */
export function hostTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Throw a clear error if `tz` is not a usable IANA timezone. */
export function assertTimezone(tz: string): void {
  try {
    // Constructing with an invalid timeZone throws RangeError.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(
      `unknown timezone: "${tz}" (use an IANA name like "America/Mexico_City" or "UTC")`,
    );
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

/** Break an instant into its wall-clock components in `tz`. */
function zonedParts(date: Date, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map["year"] ?? "0"),
    month: Number(map["month"] ?? "0"),
    day: Number(map["day"] ?? "0"),
    hour: Number(map["hour"] ?? "0"),
    minute: Number(map["minute"] ?? "0"),
    second: Number(map["second"] ?? "0"),
    weekday: map["weekday"] ?? "",
  };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Minutes east of UTC for `tz` at the given instant (DST-aware; UTC = 0). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUTC - date.getTime()) / 60_000);
}

function offsetString(min: number): string {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** ISO-8601 in a specific zone, e.g. 2026-06-18T14:30:05-06:00. */
function isoInZone(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  const off = tzOffsetMinutes(date, tz);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetString(off)}`
  );
}

export interface FormatOptions {
  /** IANA timezone to render in (default "UTC"). Ignored for the "unix" format. */
  timezone?: string;
  /** Output shape (default "human"). */
  format?: TimeFormat;
}

/**
 * Render an instant. `unix` returns epoch seconds (timezone-independent); every
 * other format honours `timezone`. Throws on an invalid timezone.
 */
export function formatInstant(date: Date, opts: FormatOptions = {}): string {
  const format = opts.format ?? "human";
  if (format === "unix") return String(Math.floor(date.getTime() / 1000));

  const tz = opts.timezone?.trim() ? opts.timezone.trim() : "UTC";
  assertTimezone(tz);

  switch (format) {
    case "iso":
      return isoInZone(date, tz);
    case "date": {
      const p = zonedParts(date, tz);
      return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
    }
    case "time": {
      const p = zonedParts(date, tz);
      return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    }
    case "human":
    default:
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }).format(date);
  }
}

/**
 * The single line the preprocessor / CLI prepend so the model always knows the
 * current moment in both human and machine-readable form.
 */
export function timeContextLine(now: Date, timezone?: string): string {
  const tz = timezone?.trim() ? timezone.trim() : "UTC";
  const human = formatInstant(now, { timezone: tz, format: "human" });
  const iso = formatInstant(now, { timezone: tz, format: "iso" });
  return `Current date and time: ${human} (timezone ${tz}; ISO-8601 ${iso}).`;
}

/**
 * Parse a datetime string (ISO-8601, or a bare unix-seconds integer). Note: an
 * offset-less datetime is interpreted by the host runtime as LOCAL time per the
 * ECMAScript spec — include a Z/offset for an unambiguous instant.
 */
export function parseDate(input: string): Date {
  const s = input.trim();
  if (/^\d{9,10}$/.test(s)) return new Date(Number(s) * 1000);
  // A bare integer that is not 9–10-digit unix seconds is ambiguous (a year? a
  // YYYYMMDD?). Reject it instead of letting `new Date("2026")` silently become
  // Jan 1 — a wrong-but-plausible date is worse than a clear error.
  if (/^\d+$/.test(s)) {
    throw new Error(
      `ambiguous numeric date: "${input}" ` +
        `(use ISO-8601 like 2026-06-18, or unix seconds as a 10-digit number)`,
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `cannot parse date/time: "${input}" ` +
        `(use ISO-8601 like 2026-06-18 or 2026-06-18T14:30:00Z, or unix seconds)`,
    );
  }
  return d;
}

/**
 * Add a signed amount of a unit to an instant. Fixed-length units use exact
 * millisecond arithmetic; months/years use calendar math in UTC and clamp
 * end-of-month overflow (Jan 31 + 1 month → Feb 28, never Mar 3).
 */
export function addDuration(
  date: Date,
  amount: number,
  unit: DurationUnit,
): Date {
  if (!Number.isFinite(amount)) {
    throw new Error("amount must be a finite number");
  }
  if (unit === "months" || unit === "years") {
    if (!Number.isInteger(amount)) {
      throw new Error(`amount must be a whole number for ${unit}`);
    }
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    if (unit === "years") d.setUTCFullYear(d.getUTCFullYear() + amount);
    else d.setUTCMonth(d.getUTCMonth() + amount);
    if (d.getUTCDate() !== day) d.setUTCDate(0); // roll back to last valid day
    return d;
  }
  return new Date(date.getTime() + amount * UNIT_MS[unit]);
}

/**
 * Human-readable magnitude of a span (sign ignored), e.g. "3 days, 4 hours".
 * Shows the two largest non-zero units; "0 seconds" for a zero span.
 */
export function humanizeDuration(ms: number): string {
  let s = Math.round(Math.abs(ms) / 1000);
  if (s === 0) return "0 seconds";
  const units: ReadonlyArray<readonly [string, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ];
  const parts: string[] = [];
  for (const [name, sec] of units) {
    const v = Math.floor(s / sec);
    if (v > 0) {
      parts.push(`${v} ${name}${v === 1 ? "" : "s"}`);
      s -= v * sec;
    }
    if (parts.length === 2) break;
  }
  return parts.join(", ");
}

/**
 * Interpret a wall-clock string as being in `tz` and return the absolute UTC
 * instant. Used to anchor offset-less input before converting timezones. Two
 * correction passes resolve the offset for any time that actually exists.
 *
 * Edge case: a wall time inside a DST spring-forward gap (e.g. 02:30 on a day
 * the clocks jump 02:00→03:00) does not exist; it resolves to the pre-transition
 * offset (≈1h from the "forward" convention). A fall-back (repeated) time
 * resolves to one of its two valid instants. These are rare and only reachable
 * via convert_timezone's offset-less + `from` path — pass an explicit offset to
 * be unambiguous.
 */
export function zonedWallTimeToInstant(input: string, tz: string): Date {
  assertTimezone(tz);
  let s = input.trim().replace(" ", "T");
  if (!s.includes("T")) s += "T00:00:00";
  const naive = new Date(`${s}Z`); // the wall time, parsed as if it were UTC
  if (Number.isNaN(naive.getTime())) {
    throw new Error(`cannot parse date/time: "${input}"`);
  }
  let instant = naive.getTime();
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(new Date(instant), tz);
    instant = naive.getTime() - off * 60_000;
  }
  return new Date(instant);
}
