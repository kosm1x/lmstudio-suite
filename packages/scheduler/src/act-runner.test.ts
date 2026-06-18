import { describe, it, expect } from "vitest";
import { buildJobTools } from "./act-runner";

// buildJobTools is pure tool composition (no LM Studio / fs I/O), so it is
// unit-testable even though the rest of the act-runner is not.
const opts = { cwd: "/tmp/scheduler-test", timezone: "UTC" };

describe("buildJobTools", () => {
  it("gates the shell tool behind allowShell", () => {
    const denied = buildJobTools(["shell", "fs"], {
      ...opts,
      allowShell: false,
    }).map((t) => t.name);
    expect(denied).not.toContain("run_shell");
    expect(denied).toContain("read_file"); // fs still present

    const allowed = buildJobTools(["shell", "fs"], {
      ...opts,
      allowShell: true,
    }).map((t) => t.name);
    expect(allowed).toContain("run_shell");
  });

  it("uses the default groups (time/fs/data/web, no shell) when none are named", () => {
    const names = buildJobTools(undefined, { ...opts, allowShell: true }).map(
      (t) => t.name,
    );
    expect(names).toContain("now"); // time
    expect(names).toContain("read_file"); // fs
    expect(names).toContain("calculator"); // data
    expect(names).toContain("web_search"); // web
    expect(names).not.toContain("run_shell"); // shell not in defaults
  });
});
