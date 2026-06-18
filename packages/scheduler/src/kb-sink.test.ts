import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scanKbDir, type ScheduleJob } from "@lmstudio-suite/core";
import { buildScheduledNote } from "./kb-sink";

const job: ScheduleJob = {
  id: "morning-briefing",
  name: "Morning briefing",
  timezone: "UTC",
  prompt: "Summarize my inbox",
  cron: "0 9 * * *",
  enabled: true,
  createdAt: "2026-06-18T00:00:00Z",
  updatedAt: "2026-06-18T00:00:00Z",
};
const FIRED = new Date("2026-06-18T09:00:00Z");

let root = "";
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "kb-sink-"));
});
afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("buildScheduledNote", () => {
  it("emits a scheduled/ node with suite frontmatter + the result body", () => {
    const note = buildScheduledNote(job, "All clear.", FIRED);
    expect(note.path).toBe(
      "scheduled/morning-briefing-2026-06-18T09-00-00-000Z.md",
    );
    expect(note.content).toMatch(/^---\n/);
    expect(note.content).toMatch(/type: note/);
    expect(note.content).toMatch(/tags: \[scheduled, morning-briefing\]/);
    expect(note.content).toMatch(/All clear\./);
  });

  it("round-trips: the emitted node is actually indexed by scanKbDir (composes with kb-map)", async () => {
    const note = buildScheduledNote(job, "Inbox is empty.", FIRED);
    await fsp.mkdir(dirname(join(root, note.path)), { recursive: true });
    await fsp.writeFile(join(root, note.path), note.content);

    const { graph } = await scanKbDir(root);
    const indexed = graph.get(note.path);
    expect(indexed).toBeDefined();
    expect(indexed?.type).toBe("note");
    expect(indexed?.description).toMatch(/Scheduled run of "Morning briefing"/);
    expect(indexed?.tags).toContain("scheduled");
    expect(indexed?.tags).toContain("morning-briefing");
  });

  it("keeps a hostile job name inside the description scalar (no frontmatter injection)", async () => {
    // A name crafted to break out and flip the node's type/tier must stay
    // trapped in the single-line `description:` scalar (oneLine + the wrapping
    // prefix are load-bearing here).
    const evil: ScheduleJob = {
      ...job,
      name: "Evil\n---\ntier: warm\nmetadata:\n  type: project\ndescription: pwned",
    };
    const note = buildScheduledNote(evil, "body", FIRED);
    await fsp.mkdir(dirname(join(root, note.path)), { recursive: true });
    await fsp.writeFile(join(root, note.path), note.content);

    const { graph } = await scanKbDir(root);
    const indexed = graph.get(note.path);
    expect(indexed).toBeDefined();
    expect(indexed?.type).toBe("note"); // not flipped to "project"
    expect(indexed?.tier).toBe("index"); // not flipped to "warm"
    expect(indexed?.tags).toContain("scheduled");
  });
});
