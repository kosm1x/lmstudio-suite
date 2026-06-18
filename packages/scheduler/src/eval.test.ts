import { describe, it, expect } from "vitest";
import type { ScheduleJob } from "@lmstudio-suite/core";
import { isDue, advanceCron } from "./eval";

const base: ScheduleJob = {
  id: "j",
  name: "J",
  timezone: "UTC",
  prompt: "p",
  enabled: true,
  createdAt: "2026-06-18T00:00:00Z",
  updatedAt: "2026-06-18T00:00:00Z",
};
// 2026-06-18 is a Thursday, 20:30:05 UTC.
const NOW = new Date("2026-06-18T20:30:05Z");

describe("advanceCron", () => {
  it("computes the next occurrence after a date, in the given timezone", () => {
    expect(
      advanceCron(
        "0 9 * * *",
        "UTC",
        new Date("2026-06-18T20:30:05Z"),
      ).toISOString(),
    ).toBe("2026-06-19T09:00:00.000Z");
    // 9am in Mexico City (UTC-6) on the 19th is 15:00Z.
    expect(
      advanceCron(
        "0 9 * * *",
        "America/Mexico_City",
        new Date("2026-06-18T20:30:05Z"),
      ).toISOString(),
    ).toBe("2026-06-19T15:00:00.000Z");
  });
});

describe("isDue", () => {
  it("never fires a disabled job", () => {
    expect(isDue({ ...base, enabled: false, cron: "* * * * *" }, NOW).due).toBe(
      false,
    );
  });

  it("fires immediately when runRequestedAt is set", () => {
    expect(
      isDue(
        { ...base, cron: "0 9 * * *", runRequestedAt: "2026-06-18T20:00:00Z" },
        NOW,
      ),
    ).toMatchObject({ due: true, reason: "run requested" });
  });

  describe("one-shot at", () => {
    it("is due once its time has passed and it has not run yet", () => {
      expect(isDue({ ...base, at: "2026-06-18T20:00:00Z" }, NOW).due).toBe(
        true,
      );
    });
    it("is not due before its time, nor after it has already run", () => {
      expect(isDue({ ...base, at: "2026-06-19T00:00:00Z" }, NOW).due).toBe(
        false,
      );
      expect(
        isDue(
          {
            ...base,
            at: "2026-06-18T20:00:00Z",
            lastRunAt: "2026-06-18T20:00:01Z",
          },
          NOW,
        ).due,
      ).toBe(false);
    });
  });

  describe("cron", () => {
    it("is due when an occurrence has passed since the last run", () => {
      // last run today 09:00 → next is tomorrow 09:00 > NOW → not due.
      expect(
        isDue(
          { ...base, cron: "0 9 * * *", lastRunAt: "2026-06-18T09:00:00Z" },
          NOW,
        ).due,
      ).toBe(false);
      // last run yesterday → today's 09:00 passed before NOW → due.
      expect(
        isDue(
          { ...base, cron: "0 9 * * *", lastRunAt: "2026-06-17T09:00:00Z" },
          NOW,
        ).due,
      ).toBe(true);
    });

    it("uses createdAt as the baseline when never run (catch-up)", () => {
      expect(
        isDue(
          { ...base, cron: "0 9 * * *", createdAt: "2026-06-18T00:00:00Z" },
          NOW,
        ).due,
      ).toBe(true);
      expect(
        isDue(
          { ...base, cron: "0 9 * * *", createdAt: "2026-06-18T10:00:00Z" },
          NOW,
        ).due,
      ).toBe(false);
    });
  });
});
