/**
 * Run shell commands / JS snippets as child processes with a hard timeout and
 * output caps.
 *
 * Honesty note: this is resource-bounded (timeout-kill, output truncation,
 * scoped cwd), NOT a security sandbox. A child process started here has the
 * same OS privileges as the host. Gate exec behind explicit opt-in and only
 * enable it where you trust the model + prompt.
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface RunOptions {
  /** Working directory for the process. */
  cwd?: string;
  /** Kill the process after this many ms (default 30000). */
  timeoutMs?: number;
  /** Caller abort signal; aborting kills the process. */
  signal?: AbortSignal;
  /** Cap on captured stdout/stderr bytes each (default 100_000). */
  maxOutputBytes?: number;
  /** Environment for the child (defaults to the parent env). */
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null if killed by signal. */
  exitCode: number | null;
  /** Signal that terminated the process, if any (e.g. "SIGKILL"). */
  signal: string | null;
  /** True if the process was killed by the timeout. */
  timedOut: boolean;
  /** True if stdout or stderr was truncated at maxOutputBytes. */
  truncated: boolean;
}

function shellInvocation(): [string, string] {
  return process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", "/c"]
    : ["/bin/sh", "-c"];
}

/** Run a command line through the platform shell. */
export function runShell(
  command: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const [shell, flag] = shellInvocation();
  return runProcess(shell, [flag, command], options);
}

/** Run an ES-module JS snippet in a fresh `node` process. */
export function runNode(
  code: string,
  options: RunOptions = {},
): Promise<RunResult> {
  return runProcess(
    process.execPath,
    ["--input-type=module", "-e", code],
    options,
  );
}

function runProcess(
  file: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  const {
    cwd,
    timeoutMs = 30_000,
    signal,
    maxOutputBytes = 100_000,
    env,
  } = options;

  // On POSIX, run the child as its own process-group leader so we can kill the
  // whole group (shell + any grandchildren) on timeout/abort. Killing only the
  // shell would orphan grandchildren that keep the stdout pipe open, delaying
  // the "close" event until they exit on their own.
  const detached = process.platform !== "win32";

  return new Promise<RunResult>((resolveResult) => {
    const child = spawn(file, args, { cwd, env: env ?? process.env, detached });

    const killChild = () => {
      if (detached && typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          /* group already gone; fall through to direct kill */
        }
      }
      child.kill("SIGKILL");
    };

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    // Decode through a StringDecoder per stream so a multi-byte UTF-8 character
    // split across two chunks is not corrupted into replacement characters.
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    const append = (current: string, text: string): string => {
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      return current + text;
    };
    child.stdout.on(
      "data",
      (c: Buffer) => (stdout = append(stdout, outDecoder.write(c))),
    );
    child.stderr.on(
      "data",
      (c: Buffer) => (stderr = append(stderr, errDecoder.write(c))),
    );

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);

    const onAbort = () => killChild();
    if (signal) {
      if (signal.aborted) killChild();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolveResult(result);
    };

    // Truncates AND records that truncation happened (a single oversized chunk
    // can overshoot maxOutputBytes before `append` starts dropping data).
    const clamp = (s: string) => {
      if (s.length > maxOutputBytes) {
        truncated = true;
        return s.slice(0, maxOutputBytes) + "\n…[truncated]";
      }
      return s;
    };

    child.on("error", (err) =>
      finish({
        stdout: clamp(stdout + outDecoder.end()),
        stderr: clamp(stderr + errDecoder.end() + `\n${String(err)}`),
        exitCode: null,
        signal: null,
        timedOut,
        truncated,
      }),
    );
    child.on("close", (code, sig) =>
      finish({
        stdout: clamp(stdout + outDecoder.end()),
        stderr: clamp(stderr + errDecoder.end()),
        exitCode: code,
        signal: sig,
        timedOut,
        truncated,
      }),
    );
  });
}
