import { describe, it, expect } from "vitest";
import {
  formatInstant,
  timeContextLine,
  parseDate,
  addDuration,
  humanizeDuration,
  tzOffsetMinutes,
  zonedWallTimeToInstant,
  assertTimezone,
  UNIT_MS,
} from "./time";

// A fixed instant used throughout: 2026-06-18T20:30:05Z.
// In America/Mexico_City (CST, UTC-6, no DST) that is 14:30:05 local.
const T = new Date("2026-06-18T20:30:05Z");
const MX = "America/Mexico_City";

describe("formatInstant", () => {
  it("renders ISO-8601 with the zone's offset", () => {
    expect(formatInstant(T, { timezone: MX, format: "iso" })).toBe(
      "2026-06-18T14:30:05-06:00",
    );
    expect(formatInstant(T, { timezone: "UTC", format: "iso" })).toBe(
      "2026-06-18T20:30:05+00:00",
    );
  });

  it("renders date and time in the given zone", () => {
    expect(formatInstant(T, { timezone: MX, format: "date" })).toBe(
      "2026-06-18",
    );
    expect(formatInstant(T, { timezone: MX, format: "time" })).toBe("14:30:05");
  });

  it("unix is timezone-independent epoch seconds", () => {
    expect(formatInstant(T, { format: "unix" })).toBe("1781814605");
    expect(formatInstant(T, { timezone: MX, format: "unix" })).toBe(
      "1781814605",
    );
  });

  it("human format includes weekday and zone name", () => {
    const h = formatInstant(T, { timezone: "UTC", format: "human" });
    expect(h).toMatch(/Thursday/);
    expect(h).toMatch(/June/);
    expect(h).toMatch(/2026/);
  });

  it("defaults to UTC when no timezone is given", () => {
    expect(formatInstant(T, { format: "iso" })).toMatch(/\+00:00$/);
  });

  it("throws on an unknown timezone", () => {
    expect(() => formatInstant(T, { timezone: "Mars/Phobos" })).toThrow(
      /unknown timezone/,
    );
  });
});

describe("tzOffsetMinutes", () => {
  it("computes a negative offset for the Americas and 0 for UTC", () => {
    expect(tzOffsetMinutes(T, "UTC")).toBe(0);
    expect(tzOffsetMinutes(T, MX)).toBe(-360);
  });

  it("is DST-aware (New York is -4 in summer, -5 in winter)", () => {
    const summer = new Date("2026-07-01T12:00:00Z");
    const winter = new Date("2026-01-01T12:00:00Z");
    expect(tzOffsetMinutes(summer, "America/New_York")).toBe(-240);
    expect(tzOffsetMinutes(winter, "America/New_York")).toBe(-300);
  });
});

describe("timeContextLine", () => {
  it("carries both human and ISO forms plus the timezone", () => {
    const line = timeContextLine(T, MX);
    expect(line).toMatch(/Current date and time:/);
    expect(line).toMatch(/timezone America\/Mexico_City/);
    expect(line).toMatch(/2026-06-18T14:30:05-06:00/);
  });
});

describe("parseDate", () => {
  it("parses ISO and unix-seconds, and rejects garbage", () => {
    expect(parseDate("2026-06-18T20:30:05Z").getTime()).toBe(T.getTime());
    expect(parseDate("1781814605").getTime()).toBe(T.getTime());
    expect(() => parseDate("not a date")).toThrow(/cannot parse/);
  });

  it("rejects an ambiguous bare integer instead of treating it as Jan 1", () => {
    expect(() => parseDate("2026")).toThrow(/ambiguous numeric date/);
    expect(() => parseDate("20260618")).toThrow(); // 8-digit YYYYMMDD is not a real date
  });
});

describe("addDuration", () => {
  it("adds fixed-length units exactly", () => {
    expect(addDuration(T, 90, "minutes").toISOString()).toBe(
      "2026-06-18T22:00:05.000Z",
    );
    expect(addDuration(T, -1, "days").toISOString()).toBe(
      "2026-06-17T20:30:05.000Z",
    );
    expect(addDuration(T, 2, "weeks").getTime()).toBe(
      T.getTime() + 2 * UNIT_MS.weeks,
    );
  });

  it("adds calendar months/years and clamps end-of-month overflow", () => {
    const jan31 = new Date("2026-01-31T12:00:00Z");
    expect(addDuration(jan31, 1, "months").toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    const leapDay = new Date("2028-02-29T00:00:00Z");
    expect(addDuration(leapDay, 1, "years").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("rejects fractional months/years and non-finite amounts", () => {
    expect(() => addDuration(T, 1.5, "months")).toThrow(/whole number/);
    expect(() => addDuration(T, Infinity, "days")).toThrow(/finite/);
  });
});

describe("humanizeDuration", () => {
  it("shows the two largest non-zero units, sign-independent", () => {
    expect(humanizeDuration(0)).toBe("0 seconds");
    expect(humanizeDuration(1000)).toBe("1 second");
    expect(humanizeDuration(-90 * 60_000)).toBe("1 hour, 30 minutes");
    expect(humanizeDuration(3 * 86_400_000 + 4 * 3_600_000 + 5_000)).toBe(
      "3 days, 4 hours",
    );
  });
});

describe("zonedWallTimeToInstant", () => {
  it("anchors an offset-less wall time to the source zone", () => {
    // 14:30:05 in Mexico City is the same instant as our 20:30:05Z fixture.
    expect(zonedWallTimeToInstant("2026-06-18 14:30:05", MX).getTime()).toBe(
      T.getTime(),
    );
    // Date-only wall time → midnight in the zone.
    expect(zonedWallTimeToInstant("2026-06-18", "UTC").toISOString()).toBe(
      "2026-06-18T00:00:00.000Z",
    );
  });

  it("documents the DST spring-forward gap: a nonexistent wall time does not round-trip", () => {
    // 02:30 on 2026-03-08 in New York does not exist (clocks jump 02:00→03:00).
    // It resolves to the pre-transition offset rather than shifting forward — a
    // known, documented limitation (see zonedWallTimeToInstant's doc comment).
    const gap = zonedWallTimeToInstant(
      "2026-03-08 02:30:00",
      "America/New_York",
    );
    const localHour = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(gap);
    expect(localHour).not.toBe("02"); // proves the gap time was not preserved
  });
});

describe("assertTimezone", () => {
  it("accepts IANA names and rejects nonsense", () => {
    expect(() => assertTimezone("UTC")).not.toThrow();
    expect(() => assertTimezone(MX)).not.toThrow();
    expect(() => assertTimezone("Nowhere/Land")).toThrow(/unknown timezone/);
  });
});
