import { describe, expect, it } from "vitest";
import { runShell, runNode } from "./run";

describe("runShell", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runShell("echo hello");
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it("reports non-zero exit codes", async () => {
    const r = await runShell("exit 3");
    expect(r.exitCode).toBe(3);
  });

  it("kills long-running commands at the timeout", async () => {
    const r = await runShell("sleep 5", { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe("SIGKILL");
  });

  it("truncates output beyond maxOutputBytes", async () => {
    const r = await runShell("yes abcdefgh | head -c 5000", {
      maxOutputBytes: 100,
    });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThan(200);
  });

  it("honours an already-aborted signal", async () => {
    const r = await runShell("sleep 5", { signal: AbortSignal.abort() });
    expect(r.signal).toBe("SIGKILL");
  });

  it("reports a clear error when the cwd does not exist", async () => {
    const r = await runShell("ls", { cwd: "/no/such/dir/on/this/box" });
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toMatch(/working directory does not exist/);
    expect(r.stderr).not.toMatch(/spawn .* ENOENT/);
  });
});

describe("runShell utf-8", () => {
  it("does not corrupt multi-byte characters (regression)", async () => {
    const r = await runShell("printf 'héllo 你好 🚀'");
    expect(r.stdout).toBe("héllo 你好 🚀");
  });
});

describe("runNode", () => {
  it("runs an ES-module snippet and captures console output", async () => {
    const r = await runNode("console.log(1 + 1)");
    expect(r.stdout.trim()).toBe("2");
    expect(r.exitCode).toBe(0);
  });
});
