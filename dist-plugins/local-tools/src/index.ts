// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-local. Do not edit; regenerate instead.

// packages/plugin-local/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var chatConfigSchematics = createConfigSchematics().field(
  "enableShell",
  "boolean",
  {
    displayName: "Enable run_shell",
    hint: "Let the model run shell commands in the prediction's working directory. Off by default.",
    warning: "run_shell executes commands with your user account's privileges. It is resource-bounded (timeout + output cap) but is NOT a security sandbox. Only enable for trusted models/tasks."
  },
  false
).field(
  "commandTimeoutMs",
  "numeric",
  {
    displayName: "Shell command timeout (ms)",
    hint: "run_shell kills any command that runs longer than this.",
    int: true,
    min: 1e3,
    max: 6e5
  },
  3e4
).build();

// packages/plugin-local/src/tools.ts
import "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/fs/scoped-fs.ts
import { promises as fsp } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
var PathEscapeError = class extends Error {
  constructor(p) {
    super(`Path escapes the allowed root directory: ${p}`);
    this.name = "PathEscapeError";
  }
};
var ScopedFs = class {
  /** Absolute, resolved root directory. */
  root;
  maxReadBytes;
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.maxReadBytes = options.maxReadBytes ?? 1e6;
  }
  /** Resolve a relative path within the root, throwing if it would escape. */
  resolvePath(relPath) {
    const target = resolve(this.root, relPath);
    const rel = relative(this.root, target);
    if (rel === "") return target;
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }
  async readFile(relPath) {
    const p = this.resolvePath(relPath);
    const stat = await fsp.stat(p);
    if (stat.size <= this.maxReadBytes) return fsp.readFile(p, "utf-8");
    const fh = await fsp.open(p, "r");
    try {
      const buf = Buffer.alloc(this.maxReadBytes);
      const { bytesRead } = await fh.read(buf, 0, this.maxReadBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf-8") + "\n\u2026[truncated]";
    } finally {
      await fh.close();
    }
  }
  /** Write a file, creating parent directories as needed. */
  async writeFile(relPath, content) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    await fsp.writeFile(p, content, "utf-8");
  }
  async list(relPath = ".") {
    const p = this.resolvePath(relPath);
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map(
      (e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other"
      })
    ).sort((a, b) => a.name.localeCompare(b.name));
  }
  async exists(relPath) {
    try {
      await fsp.stat(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }
  async mkdir(relPath) {
    await fsp.mkdir(this.resolvePath(relPath), { recursive: true });
  }
  /** Remove a file or directory. Refuses to remove the root itself. */
  async remove(relPath) {
    const p = this.resolvePath(relPath);
    if (p === this.root)
      throw new Error("Refusing to remove the root directory.");
    await fsp.rm(p, { recursive: true, force: true });
  }
};

// packages/core/src/exec/run.ts
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
function shellInvocation() {
  return process.platform === "win32" ? [process.env.ComSpec ?? "cmd.exe", "/c"] : ["/bin/sh", "-c"];
}
function runShell(command, options = {}) {
  const [shell, flag] = shellInvocation();
  return runProcess(shell, [flag, command], options);
}
function runProcess(file, args, options) {
  const {
    cwd,
    timeoutMs = 3e4,
    signal,
    maxOutputBytes = 1e5,
    env
  } = options;
  const detached = process.platform !== "win32";
  return new Promise((resolveResult) => {
    const child = spawn(file, args, { cwd, env: env ?? process.env, detached });
    const killChild = () => {
      if (detached && typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
        }
      }
      child.kill("SIGKILL");
    };
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    const append = (current, text) => {
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      return current + text;
    };
    child.stdout.on(
      "data",
      (c) => stdout = append(stdout, outDecoder.write(c))
    );
    child.stderr.on(
      "data",
      (c) => stderr = append(stderr, errDecoder.write(c))
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
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolveResult(result);
    };
    const clamp = (s) => {
      if (s.length > maxOutputBytes) {
        truncated = true;
        return s.slice(0, maxOutputBytes) + "\n\u2026[truncated]";
      }
      return s;
    };
    child.on(
      "error",
      (err) => finish({
        stdout: clamp(stdout + outDecoder.end()),
        stderr: clamp(stderr + errDecoder.end() + `
${String(err)}`),
        exitCode: null,
        signal: null,
        timedOut,
        truncated
      })
    );
    child.on(
      "close",
      (code, sig) => finish({
        stdout: clamp(stdout + outDecoder.end()),
        stderr: clamp(stderr + errDecoder.end()),
        exitCode: code,
        signal: sig,
        timedOut,
        truncated
      })
    );
  });
}

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";
var msg = (err) => err instanceof Error ? err.message : String(err);
function createFsTools(options) {
  const fs = new ScopedFs(options.root);
  return [
    tool2({
      name: "read_file",
      description: "Read a UTF-8 text file. Paths are relative to the working directory; '..' escapes are rejected.",
      parameters: {
        path: z2.string().describe("Relative path of the file to read.")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Reading ${path}`);
        try {
          return await fs.readFile(path);
        } catch (err) {
          const m = msg(err);
          warn(`read_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool2({
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file (parent directories are created). Paths are relative to the working directory.",
      parameters: {
        path: z2.string().describe("Relative destination path."),
        content: z2.string().describe("The full file contents to write.")
      },
      implementation: async ({ path, content }, { status, warn }) => {
        status(`Writing ${path}`);
        try {
          await fs.writeFile(path, content);
          return `Wrote ${content.length} characters to ${path}.`;
        } catch (err) {
          const m = msg(err);
          warn(`write_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool2({
      name: "list_dir",
      description: "List the files and subdirectories of a directory. Paths are relative to the working directory; use '.' for the root.",
      parameters: {
        path: z2.string().default(".").describe("Relative directory path (defaults to '.').")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Listing ${path}`);
        try {
          const entries = await fs.list(path);
          if (entries.length === 0) return "(empty directory)";
          return entries.map((e) => `${e.type === "dir" ? "[dir] " : "      "}${e.name}`).join("\n");
        } catch (err) {
          const m = msg(err);
          warn(`list_dir failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    })
  ];
}
function createShellTool(options) {
  const timeoutMs = options.timeoutMs ?? 3e4;
  return tool2({
    name: "run_shell",
    description: "Run a shell command in the working directory and return its exit code, stdout, and stderr. Use for builds, tests, git, or file tooling.",
    parameters: {
      command: z2.string().describe("The shell command line to execute.")
    },
    implementation: async ({ command }, { status, warn, signal }) => {
      status(`$ ${command}`);
      const r = await runShell(command, {
        cwd: options.cwd,
        timeoutMs,
        signal
      });
      if (r.timedOut) warn(`run_shell timed out after ${timeoutMs}ms`);
      const parts = [`exit: ${r.timedOut ? "timed out" : r.exitCode}`];
      if (r.stdout) parts.push(`stdout:
${r.stdout}`);
      if (r.stderr) parts.push(`stderr:
${r.stderr}`);
      return parts.join("\n\n");
    }
  });
}

// packages/plugin-local/src/tools.ts
async function resolveRoot(ctl) {
  try {
    return ctl.getWorkingDirectory();
  } catch {
    const fallback = join(tmpdir(), "lmstudio-local-tools");
    await mkdir(fallback, { recursive: true }).catch(() => {
    });
    return fallback;
  }
}
async function toolsProvider(ctl) {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = await resolveRoot(ctl);
  const tools = createFsTools({ root });
  if (chat.get("enableShell")) {
    tools.push(
      createShellTool({ cwd: root, timeoutMs: chat.get("commandTimeoutMs") })
    );
  }
  return tools;
}

// packages/plugin-local/src/index.ts
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withToolsProvider(toolsProvider);
}
export {
  main
};
