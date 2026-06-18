// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-time. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/time/time.ts
var UNIT_MS = {
  seconds: 1e3,
  minutes: 6e4,
  hours: 36e5,
  days: 864e5,
  weeks: 6048e5
};
var HAS_OFFSET = /(?:[zZ])$|[+-]\d{2}:?\d{2}$/;
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
function zonedParts(date, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long"
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map["year"] ?? "0"),
    month: Number(map["month"] ?? "0"),
    day: Number(map["day"] ?? "0"),
    hour: Number(map["hour"] ?? "0"),
    minute: Number(map["minute"] ?? "0"),
    second: Number(map["second"] ?? "0"),
    weekday: map["weekday"] ?? ""
  };
}
function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}
function tzOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  return Math.round((asUTC - date.getTime()) / 6e4);
}
function offsetString(min) {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function isoInZone(date, tz) {
  const p = zonedParts(date, tz);
  const off = tzOffsetMinutes(date, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetString(off)}`;
}
function formatInstant(date, opts = {}) {
  const format = opts.format ?? "human";
  if (format === "unix") return String(Math.floor(date.getTime() / 1e3));
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
        timeZoneName: "short"
      }).format(date);
  }
}
function timeContextLine(now, timezone) {
  const tz = timezone?.trim() ? timezone.trim() : "UTC";
  const human = formatInstant(now, { timezone: tz, format: "human" });
  const iso = formatInstant(now, { timezone: tz, format: "iso" });
  return `Current date and time: ${human} (timezone ${tz}; ISO-8601 ${iso}).`;
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
function addDuration(date, amount, unit) {
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
    if (d.getUTCDate() !== day) d.setUTCDate(0);
    return d;
  }
  return new Date(date.getTime() + amount * UNIT_MS[unit]);
}
function humanizeDuration(ms) {
  let s = Math.round(Math.abs(ms) / 1e3);
  if (s === 0) return "0 seconds";
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const parts = [];
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
function zonedWallTimeToInstant(input, tz) {
  assertTimezone(tz);
  let s = input.trim().replace(" ", "T");
  if (!s.includes("T")) s += "T00:00:00";
  const naive = /* @__PURE__ */ new Date(`${s}Z`);
  if (Number.isNaN(naive.getTime())) {
    throw new Error(`cannot parse date/time: "${input}"`);
  }
  let instant = naive.getTime();
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(new Date(instant), tz);
    instant = naive.getTime() - off * 6e4;
  }
  return new Date(instant);
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
var msg = (err) => err instanceof Error ? err.message : String(err);
var FORMATS = ["iso", "human", "date", "time", "unix"];
var ADD_UNITS = [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years"
];
var DIFF_UNITS = [
  "auto",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks"
];
function round3(n) {
  return Math.round(n * 1e3) / 1e3;
}
function createTimeTools(options = {}) {
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const defaultTz = options.defaultTimezone?.trim() ? options.defaultTimezone.trim() : hostTimezone();
  return [
    tool7({
      name: "now",
      description: `Get the current date and time. Use this whenever you need to know what 'today', 'now', or the current year/time is \u2014 do not guess it. Returns the time in the configured zone (${defaultTz}) unless you pass another. Formats: iso (machine-readable with offset), human, date, time, unix (epoch seconds).`,
      parameters: {
        timezone: z7.string().optional().describe(
          `IANA timezone, e.g. 'America/Mexico_City' or 'UTC'. Default: ${defaultTz}.`
        ),
        format: z7.enum(FORMATS).default("human").describe("Output format. Default 'human'.")
      },
      implementation: async ({ timezone, format }, { status }) => {
        status("now");
        try {
          return formatInstant(now(), {
            timezone: timezone?.trim() || defaultTz,
            format
          });
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool7({
      name: "time_until",
      description: "Compute how far a target date/time is from now, as a human phrase like 'in 3 days, 4 hours' or '2 hours ago'. Use for deadlines, countdowns, or 'how long until X'. Give the target as ISO-8601 (include a Z/offset to be exact).",
      parameters: {
        target: z7.string().describe(
          "Target datetime, ISO-8601, e.g. '2026-12-25' or '2026-06-20T09:00:00Z'."
        )
      },
      implementation: async ({ target }, { status }) => {
        status("time_until");
        try {
          const ms = parseDate(target).getTime() - now().getTime();
          if (Math.abs(ms) < 1e3) return "now (less than a second away)";
          const span = humanizeDuration(ms);
          return ms > 0 ? `in ${span}` : `${span} ago`;
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool7({
      name: "add_duration",
      description: "Add (or subtract, with a negative amount) a duration to a date/time and return the result as ISO-8601. Use for 'what date is 90 days from X', scheduling, expiry math. months/years use calendar math and clamp end-of-month (Jan 31 + 1 month \u2192 Feb 28).",
      parameters: {
        datetime: z7.string().describe("Starting datetime, ISO-8601 (or unix seconds)."),
        amount: z7.number().describe("How many units to add; negative subtracts."),
        unit: z7.enum(ADD_UNITS).describe(
          "Unit of the amount (whole numbers only for months/years)."
        ),
        timezone: z7.string().optional().describe(
          `IANA timezone for the returned ISO string. Default: ${defaultTz}.`
        )
      },
      implementation: async ({ datetime, amount, unit, timezone }, { status }) => {
        status("add_duration");
        try {
          const result = addDuration(
            parseDate(datetime),
            amount,
            unit
          );
          return formatInstant(result, {
            timezone: timezone?.trim() || defaultTz,
            format: "iso"
          });
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool7({
      name: "diff_dates",
      description: "Difference between two datetimes. With unit 'auto' (default) returns a human phrase like '3 days, 4 hours later'; with a fixed unit (seconds\u2026weeks) returns the exact numeric difference (to \u2212 from) in that unit. Include Z/offsets for exactness.",
      parameters: {
        from: z7.string().describe("Start datetime, ISO-8601 (or unix seconds)."),
        to: z7.string().describe("End datetime, ISO-8601 (or unix seconds)."),
        unit: z7.enum(DIFF_UNITS).default("auto").describe(
          "'auto' for a human phrase, or seconds/minutes/hours/days/weeks."
        )
      },
      implementation: async ({ from, to, unit }, { status }) => {
        status("diff_dates");
        try {
          const ms = parseDate(to).getTime() - parseDate(from).getTime();
          if (unit === "auto") {
            if (ms === 0) return "the same instant";
            return `${humanizeDuration(ms)} ${ms > 0 ? "later" : "earlier"}`;
          }
          return String(round3(ms / UNIT_MS[unit]));
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool7({
      name: "convert_timezone",
      description: "Convert a datetime from one timezone to another. If the input has a Z/offset it is an exact instant and 'from' is ignored; if it is an offset-less wall time, pass 'from' to say which zone it is in (otherwise it is read as UTC). Returns the time in the target zone (human + ISO).",
      parameters: {
        datetime: z7.string().describe(
          "Datetime to convert, e.g. '2026-06-18 14:00' or '2026-06-18T20:00:00Z'."
        ),
        to: z7.string().describe("Target IANA timezone, e.g. 'Asia/Tokyo'."),
        from: z7.string().optional().describe(
          "Source IANA timezone for an offset-less input (default: UTC)."
        )
      },
      implementation: async ({ datetime, to, from }, { status }) => {
        status("convert_timezone");
        try {
          const absolute = HAS_OFFSET.test(datetime.trim());
          const instant = absolute ? parseDate(datetime) : zonedWallTimeToInstant(datetime, from?.trim() || "UTC");
          const human = formatInstant(instant, {
            timezone: to,
            format: "human"
          });
          const iso = formatInstant(instant, { timezone: to, format: "iso" });
          const note = !absolute && !from?.trim() ? " (input read as UTC; pass 'from' to set its source zone)" : "";
          return `${human}
ISO: ${iso}${note}`;
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    })
  ];
}

// packages/plugin-time/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var globalConfigSchematics = createConfigSchematics().field(
  "timezone",
  "string",
  {
    displayName: "Default timezone",
    hint: "IANA timezone the date/time injection and tools use by default (e.g. 'America/Mexico_City'). Leave blank to use this machine's timezone.",
    placeholder: "America/Mexico_City"
  },
  ""
).build();
var chatConfigSchematics = createConfigSchematics().field(
  "injectDateTime",
  "boolean",
  {
    displayName: "Inject current date/time",
    hint: "Prepend a 'Current date and time: \u2026' line to each message so the model never guesses the date. On by default."
  },
  true
).field(
  "enableTools",
  "boolean",
  {
    displayName: "Expose date/time tools",
    hint: "Provide now, time_until, add_duration, diff_dates, convert_timezone. On by default."
  },
  true
).build();

// packages/plugin-time/src/index.ts
function resolveTimezone(raw) {
  const t = raw.trim();
  return t || hostTimezone();
}
async function preprocess(ctl, userMessage) {
  const text = userMessage.getText();
  if (!text.trim()) return userMessage;
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("injectDateTime")) return userMessage;
  try {
    const tz = resolveTimezone(
      ctl.getGlobalPluginConfig(globalConfigSchematics).get("timezone")
    );
    return `${timeContextLine(/* @__PURE__ */ new Date(), tz)}

${text}`;
  } catch {
    return userMessage;
  }
}
async function toolsProvider(ctl) {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  if (!chat.get("enableTools")) return [];
  const tz = resolveTimezone(
    ctl.getGlobalPluginConfig(globalConfigSchematics).get("timezone")
  );
  return createTimeTools({ defaultTimezone: tz });
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withPromptPreprocessor(preprocess).withToolsProvider(toolsProvider);
}
export {
  main,
  preprocess,
  toolsProvider
};
