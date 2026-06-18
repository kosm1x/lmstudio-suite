import { describe, it, expect } from "vitest";
import { createTimeTools, type TimeToolsOptions } from "./time-tools";

const ctx = {
  status: () => {},
  warn: () => {},
  signal: new AbortController().signal,
  callId: 0,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createTimeTools>[number]["implementation"]>
>[1];

// Fixed clock: 2026-06-18T20:30:05Z === 14:30:05 in America/Mexico_City.
const NOW = new Date("2026-06-18T20:30:05Z");
const MX = "America/Mexico_City";

function call(
  name: string,
  params: Record<string, unknown>,
  opts: TimeToolsOptions = { now: () => NOW, defaultTimezone: "UTC" },
): Promise<string> {
  const t = createTimeTools(opts).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t.implementation!(params, ctx) as Promise<string>;
}

describe("now", () => {
  it("returns the injected clock in the requested zone and format", async () => {
    expect(await call("now", { timezone: MX, format: "iso" })).toBe(
      "2026-06-18T14:30:05-06:00",
    );
    expect(await call("now", { format: "date" })).toBe("2026-06-18");
  });

  it("falls back to the configured default timezone", async () => {
    expect(
      await call(
        "now",
        { format: "iso" },
        { now: () => NOW, defaultTimezone: MX },
      ),
    ).toBe("2026-06-18T14:30:05-06:00");
  });

  it("reports an error for an unknown timezone instead of throwing", async () => {
    expect(await call("now", { timezone: "Bogus/Zone" })).toMatch(
      /Error: unknown timezone/,
    );
  });
});

describe("time_until", () => {
  it("phrases a future target with 'in' and a past one with 'ago'", async () => {
    expect(await call("time_until", { target: "2026-06-21T20:30:05Z" })).toBe(
      "in 3 days",
    );
    expect(await call("time_until", { target: "2026-06-18T18:30:05Z" })).toBe(
      "2 hours ago",
    );
  });

  it("collapses a sub-second gap to 'now'", async () => {
    expect(
      await call("time_until", { target: "2026-06-18T20:30:05Z" }),
    ).toMatch(/^now/);
  });
});

describe("add_duration", () => {
  it("adds fixed units and returns ISO in the default zone", async () => {
    expect(
      await call("add_duration", {
        datetime: "2026-06-18T20:30:05Z",
        amount: 90,
        unit: "minutes",
      }),
    ).toBe("2026-06-18T22:00:05+00:00");
  });

  it("does calendar months with end-of-month clamp", async () => {
    expect(
      await call("add_duration", {
        datetime: "2026-01-31T12:00:00Z",
        amount: 1,
        unit: "months",
      }),
    ).toBe("2026-02-28T12:00:00+00:00");
  });

  it("returns a clear error on a bad amount", async () => {
    expect(
      await call("add_duration", {
        datetime: "2026-01-31T12:00:00Z",
        amount: 1.5,
        unit: "months",
      }),
    ).toMatch(/Error: amount must be a whole number/);
  });
});

describe("diff_dates", () => {
  it("auto mode gives a human phrase with direction", async () => {
    expect(
      await call("diff_dates", {
        from: "2026-06-18T20:30:05Z",
        to: "2026-06-22T00:30:05Z",
        unit: "auto",
      }),
    ).toBe("3 days, 4 hours later");
  });

  it("a fixed unit gives the exact numeric difference", async () => {
    expect(
      await call("diff_dates", {
        from: "2026-06-18T00:00:00Z",
        to: "2026-06-18T12:00:00Z",
        unit: "hours",
      }),
    ).toBe("12");
    expect(
      await call("diff_dates", {
        from: "2026-06-22T00:00:00Z",
        to: "2026-06-18T00:00:00Z",
        unit: "days",
      }),
    ).toBe("-4");
  });
});

describe("convert_timezone", () => {
  it("converts an absolute instant into the target zone", async () => {
    const r = await call("convert_timezone", {
      datetime: "2026-06-18T20:30:05Z",
      to: MX,
    });
    expect(r).toMatch(/ISO: 2026-06-18T14:30:05-06:00/);
  });

  it("anchors an offset-less wall time with 'from'", async () => {
    const r = await call("convert_timezone", {
      datetime: "2026-06-18 14:30:05",
      from: MX,
      to: "UTC",
    });
    expect(r).toMatch(/ISO: 2026-06-18T20:30:05\+00:00/);
    expect(r).not.toMatch(/read as UTC/);
  });

  it("notes when an offset-less input was read as UTC", async () => {
    const r = await call("convert_timezone", {
      datetime: "2026-06-18 14:30:05",
      to: MX,
    });
    expect(r).toMatch(/read as UTC/);
  });
});
