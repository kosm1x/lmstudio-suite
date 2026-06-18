// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-local. Do not edit; regenerate instead.

// packages/plugin-local/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var chatConfigSchematics = createConfigSchematics().field(
  "workingDir",
  "string",
  {
    displayName: "Working directory",
    hint: "Absolute path the file/shell tools operate in (e.g. your project folder). Supports a leading ~. Leave blank to use the chat's auto working directory, falling back to a temp sandbox.",
    placeholder: "~/projects/my-app"
  },
  ""
).field(
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
).field(
  "shellDeny",
  "stringArray",
  {
    displayName: "Shell deny list",
    hint: "Command names (e.g. rm, shutdown) that run_shell always refuses. Matched against the leading executable of each pipeline segment, by basename. A guardrail, not a sandbox."
  },
  []
).field(
  "shellAllow",
  "stringArray",
  {
    displayName: "Shell allow list",
    hint: "If non-empty, run_shell only permits these command names (e.g. git, npm, node). Leave empty to allow anything not on the deny list."
  },
  []
).build();

// packages/plugin-local/src/tools.ts
import "@lmstudio/sdk";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve as resolve2 } from "node:path";

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/fs/scoped-fs.ts
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
var DEFAULT_IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules"
]);
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
  /**
   * Read the entire file with no truncation cap. Use for edit/transform
   * operations, where writing back a model-facing (size-capped) read would
   * silently drop everything past the cap. `readFile` is the capped read.
   */
  async readFileFull(relPath) {
    return fsp.readFile(this.resolvePath(relPath), "utf-8");
  }
  /**
   * Write a file, creating parent directories as needed.
   *
   * Atomic: the content is staged to a sibling temp file and renamed into
   * place, so a crash mid-write leaves the temp file rather than a truncated
   * original. (rename is atomic within a filesystem; the temp sits in the same
   * directory as the target, hence the same filesystem.) This matters for
   * `edit_file`, where a partial write would corrupt existing content.
   */
  async writeFile(relPath, content) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /**
   * Atomic write that skips the write entirely when the file already holds
   * exactly `content`. Returns `true` if it wrote, `false` if the file was
   * already identical. Compares against the FULL existing content (not the
   * truncated read), so an over-cap but unchanged file is still detected as a
   * no-op. Lets a write tool report "already saved" instead of redoing an
   * expensive write — and gives a looping model a clear terminal signal.
   */
  async writeFileIfChanged(relPath, content) {
    const existing = await this.readFileFull(relPath).catch(() => null);
    if (existing === content) return false;
    await this.writeFile(relPath, content);
    return true;
  }
  /** Atomically write raw bytes (e.g. a downloaded file). Same temp+rename. */
  async writeBytes(relPath, data) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /** Move/rename a file within the root; both ends are traversal-guarded. */
  async move(fromRel, toRel) {
    const from = this.resolvePath(fromRel);
    const to = this.resolvePath(toRel);
    await fsp.mkdir(dirname(to), { recursive: true });
    await fsp.rename(from, to);
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
  /** Type + size + mtime for a path. Throws (ENOENT) if it does not exist. */
  async stat(relPath) {
    const s = await fsp.stat(this.resolvePath(relPath));
    return {
      type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
      size: s.size,
      mtimeMs: s.mtimeMs
    };
  }
  /**
   * Recursively yield file paths (relative to root, POSIX-separated `/`) under
   * `relPath`. Yields files only; directories whose name is in `ignore` are
   * pruned. Symlinks are not followed, and unreadable directories are skipped
   * rather than throwing. Iteration order is unspecified — sort if you need it.
   */
  async *walk(relPath = ".", options = {}) {
    const ignore = options.ignore ?? DEFAULT_IGNORE_DIRS;
    const stack = [this.resolvePath(relPath)];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (!ignore.has(e.name)) stack.push(abs);
        } else if (e.isFile()) {
          yield relative(this.root, abs).split(sep).join("/");
        }
      }
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

// packages/core/src/fs/glob.ts
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:[^/]*/)*";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// packages/core/src/exec/run.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
    if (cwd !== void 0 && !existsSync(cwd)) {
      resolveResult({
        stdout: "",
        stderr: `Error: working directory does not exist: ${cwd}`,
        exitCode: null,
        signal: null,
        timedOut: false,
        truncated: false
      });
      return;
    }
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

// packages/core/src/exec/policy.ts
import { basename } from "node:path";
function commandHeads(command) {
  return command.split(/[|&;\n]+/).map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const tokens = seg.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      i++;
    }
    const head = tokens[i] ?? "";
    return head ? basename(head) : "";
  }).filter(Boolean);
}
function checkCommandPolicy(command, policy) {
  const allow = policy.allow ?? [];
  const deny = policy.deny ?? [];
  if (allow.length === 0 && deny.length === 0) return null;
  const heads = commandHeads(command);
  if (heads.length === 0) return null;
  const denied = heads.filter((h) => deny.includes(h));
  if (denied.length > 0) {
    return `command(s) on the deny list: ${[...new Set(denied)].join(", ")}`;
  }
  if (allow.length > 0) {
    const notAllowed = heads.filter((h) => !allow.includes(h));
    if (notAllowed.length > 0) {
      return `only [${allow.join(", ")}] are allowed (saw: ${[...new Set(notAllowed)].join(", ")})`;
    }
  }
  return null;
}

// packages/core/src/schedule/schedule.ts
var CRON_FIELDS_5 = [
  [0, 59],
  // minute
  [0, 23],
  // hour
  [1, 31],
  // day of month
  [1, 12],
  // month
  [0, 7]
  // day of week (0 and 7 = Sunday)
];
var CRON_FIELDS_6 = [
  [0, 59],
  // second
  ...CRON_FIELDS_5
];

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/http-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool3 } from "@lmstudio/sdk";
import { z as z3 } from "zod";
var SEARCH_MAX_MATCHES = 200;
var SEARCH_MAX_FILE_BYTES = 2e6;
var GLOB_MAX_RESULTS = 500;
var msg = (err) => err instanceof Error ? err.message : String(err);
function createFsTools(options) {
  const fs = new ScopedFs(options.root);
  return [
    tool3({
      name: "read_file",
      description: "Read a UTF-8 text file. Paths are relative to the working directory; '..' escapes are rejected.",
      parameters: {
        path: z3.string().describe("Relative path of the file to read.")
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
    tool3({
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file (parent directories are created). Paths are relative to the working directory.",
      parameters: {
        path: z3.string().describe("Relative destination path."),
        content: z3.string().describe("The full file contents to write.")
      },
      implementation: async ({ path, content }, { status, warn }) => {
        status(`Writing ${path}`);
        try {
          const wrote = await fs.writeFileIfChanged(path, content);
          return wrote ? `Wrote ${content.length} characters to ${path}.` : `No change: ${path} already contains exactly this content (${content.length} characters). It is already saved \u2014 do not write it again.`;
        } catch (err) {
          const m = msg(err);
          warn(`write_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool3({
      name: "edit_file",
      description: "Make a surgical edit to an existing text file: replace an exact substring with new text, without rewriting the whole file. By default old_string must match EXACTLY ONCE \u2014 include enough surrounding context (indentation, adjacent lines) to make it unique. Set replace_all to change every occurrence (e.g. renaming a symbol). The edit fails WITHOUT writing if old_string is empty, missing, equal to new_string, or (when replace_all is off) ambiguous. Matching is literal \u2014 no regex, no $ escapes. Paths are relative to the working directory; '..' escapes are rejected.",
      parameters: {
        path: z3.string().describe("Relative path of the file to edit."),
        old_string: z3.string().describe(
          "Exact text to find. Must match once unless replace_all is set."
        ),
        new_string: z3.string().describe("Text to replace it with."),
        replace_all: z3.boolean().default(false).describe(
          "Replace every occurrence instead of requiring a unique match."
        )
      },
      implementation: async ({ path, old_string, new_string, replace_all }, { status, warn }) => {
        status(`Editing ${path}`);
        try {
          if (old_string === "") return "Error: old_string must not be empty.";
          if (old_string === new_string)
            return "Error: old_string and new_string are identical; nothing to change.";
          const before = await fs.readFileFull(path);
          const occurrences = before.split(old_string).length - 1;
          if (occurrences === 0)
            return `Error: old_string not found in ${path}.`;
          if (occurrences > 1 && !replace_all)
            return `Error: old_string matches ${occurrences} times in ${path}; add surrounding context to make it unique, or set replace_all.`;
          const idx = before.indexOf(old_string);
          const after = replace_all ? before.split(old_string).join(new_string) : before.slice(0, idx) + new_string + before.slice(idx + old_string.length);
          await fs.writeFile(path, after);
          const n = replace_all ? occurrences : 1;
          return `Edited ${path}: replaced ${n} occurrence${n === 1 ? "" : "s"}. (${before.length} \u2192 ${after.length} chars)`;
        } catch (err) {
          const m = msg(err);
          warn(`edit_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool3({
      name: "list_dir",
      description: "List the files and subdirectories of a directory. Paths are relative to the working directory; use '.' for the root.",
      parameters: {
        path: z3.string().default(".").describe("Relative directory path (defaults to '.').")
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
    }),
    tool3({
      name: "search_files",
      description: "Search file CONTENTS for a regular expression, recursively under the working directory (.git and node_modules are skipped, binary files ignored). Returns matching lines as `path:line: text`. Optionally restrict to files matching a glob. Use this to find where something is defined or used before reading whole files. Output is capped \u2014 narrow the pattern or glob if you see a truncation marker.",
      parameters: {
        pattern: z3.string().describe(
          "Regular expression to search for (JavaScript regex syntax)."
        ),
        glob: z3.string().optional().describe(
          "Only search files whose path matches this glob (e.g. '**/*.ts')."
        ),
        path: z3.string().default(".").describe("Subdirectory to search under (default '.')."),
        ignore_case: z3.boolean().default(false).describe("Case-insensitive match.")
      },
      implementation: async ({ pattern, glob, path, ignore_case }, { status, warn }) => {
        status(`Searching for /${pattern}/`);
        let re;
        try {
          re = new RegExp(pattern, ignore_case ? "i" : "");
        } catch (err) {
          return `Error: invalid regular expression: ${msg(err)}`;
        }
        const globRe = glob ? globToRegExp(glob) : null;
        const base = path === "." ? "" : path.replace(/\/+$/, "") + "/";
        const out = [];
        let truncated = false;
        try {
          outer: for await (const rel of fs.walk(path)) {
            if (globRe) {
              const relBase = base && rel.startsWith(base) ? rel.slice(base.length) : rel;
              if (!globRe.test(relBase)) continue;
            }
            let info;
            try {
              info = await fs.stat(rel);
            } catch {
              continue;
            }
            if (info.size > SEARCH_MAX_FILE_BYTES) continue;
            let content;
            try {
              content = await fs.readFileFull(rel);
            } catch {
              continue;
            }
            if (content.includes("\0")) continue;
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                out.push(
                  `${rel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`
                );
                if (out.length >= SEARCH_MAX_MATCHES) {
                  truncated = true;
                  break outer;
                }
              }
            }
          }
        } catch (err) {
          const m = msg(err);
          warn(`search_files failed: ${m}`);
          return `Error: ${m}`;
        }
        if (out.length === 0) return `No matches for /${pattern}/.`;
        return out.join("\n") + (truncated ? `
\u2026[truncated at ${SEARCH_MAX_MATCHES} matches]` : "");
      }
    }),
    tool3({
      name: "glob",
      description: "List files whose path matches a glob pattern (e.g. '**/*.ts', 'src/**/*.test.ts'), recursively under the working directory (.git and node_modules skipped). Supports *, ?, and ** (crossing directories). Returns matching paths, sorted. Use to discover files by name/extension before reading.",
      parameters: {
        pattern: z3.string().describe("Glob pattern to match against file paths."),
        path: z3.string().default(".").describe(
          "Subdirectory to search under (default '.'); the pattern matches paths relative to it."
        )
      },
      implementation: async ({ pattern, path }, { status, warn }) => {
        status(`Globbing ${pattern}`);
        const globRe = globToRegExp(pattern);
        const base = path === "." ? "" : path.replace(/\/+$/, "") + "/";
        const hits = [];
        let truncated = false;
        try {
          for await (const rel of fs.walk(path)) {
            const relBase = base && rel.startsWith(base) ? rel.slice(base.length) : rel;
            if (globRe.test(relBase)) {
              hits.push(rel);
              if (hits.length >= GLOB_MAX_RESULTS) {
                truncated = true;
                break;
              }
            }
          }
        } catch (err) {
          const m = msg(err);
          warn(`glob failed: ${m}`);
          return `Error: ${m}`;
        }
        if (hits.length === 0) return `No files match ${pattern}.`;
        hits.sort();
        return hits.join("\n") + (truncated ? `
\u2026[truncated at ${GLOB_MAX_RESULTS}]` : "");
      }
    }),
    tool3({
      name: "move_file",
      description: "Move or rename a file or directory within the working directory. Both paths are relative; '..' escapes are rejected. Missing parent directories of the destination are created, and an existing destination is overwritten.",
      parameters: {
        from: z3.string().describe("Existing relative path."),
        to: z3.string().describe("New relative path.")
      },
      implementation: async ({ from, to }, { status, warn }) => {
        status(`Moving ${from} \u2192 ${to}`);
        try {
          await fs.move(from, to);
          return `Moved ${from} \u2192 ${to}.`;
        } catch (err) {
          const m = msg(err);
          warn(`move_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool3({
      name: "delete_file",
      description: "Delete a file, or a directory and all its contents, within the working directory. Relative paths only; '..' escapes are rejected; refuses to delete the root itself. Irreversible \u2014 there is no trash.",
      parameters: {
        path: z3.string().describe("Relative path to delete.")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Deleting ${path}`);
        try {
          if (!await fs.exists(path)) return `Error: ${path} does not exist.`;
          await fs.remove(path);
          return `Deleted ${path}.`;
        } catch (err) {
          const m = msg(err);
          warn(`delete_file failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool3({
      name: "make_dir",
      description: "Create a directory (and any missing parents) within the working directory. Relative paths only; '..' escapes are rejected.",
      parameters: {
        path: z3.string().describe("Relative directory path to create.")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Creating ${path}/`);
        try {
          await fs.mkdir(path);
          return `Created ${path}/.`;
        } catch (err) {
          const m = msg(err);
          warn(`make_dir failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool3({
      name: "stat_path",
      description: "Report whether a path exists and whether it is a file or directory, with its size in bytes and last-modified time. Relative paths only.",
      parameters: {
        path: z3.string().describe("Relative path to inspect.")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Stat ${path}`);
        try {
          const s = await fs.stat(path);
          return `${path}: ${s.type}, ${s.size} bytes, modified ${new Date(s.mtimeMs).toISOString()}`;
        } catch (err) {
          if (err?.code === "ENOENT")
            return `${path}: does not exist.`;
          const m = msg(err);
          warn(`stat_path failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    })
  ];
}
function createShellTool(options) {
  const timeoutMs = options.timeoutMs ?? 3e4;
  const policy = options.policy ?? {};
  return tool3({
    name: "run_shell",
    description: "Run a shell command in the working directory and return its exit code, stdout, and stderr. Use for builds, tests, git, or file tooling. The operator may restrict which commands are allowed; a blocked command is refused without running.",
    parameters: {
      command: z3.string().describe("The shell command line to execute.")
    },
    implementation: async ({ command }, { status, warn, signal }) => {
      const denial = checkCommandPolicy(command, policy);
      if (denial) {
        warn(`run_shell refused: ${denial}`);
        return `Error: command refused by policy \u2014 ${denial}.`;
      }
      status(`$ ${command}`);
      const r = await runShell(command, {
        cwd: options.cwd,
        timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        signal
      });
      if (r.timedOut) warn(`run_shell timed out after ${timeoutMs}ms`);
      const parts = [`exit: ${r.timedOut ? "timed out" : r.exitCode}`];
      if (r.stdout) parts.push(`stdout:
${r.stdout}`);
      if (r.stderr) parts.push(`stderr:
${r.stderr}`);
      if (r.truncated) parts.push("[output truncated at the byte cap]");
      return parts.join("\n\n");
    }
  });
}

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

// packages/core/src/tools/schedule-tools.ts
import { tool as tool8 } from "@lmstudio/sdk";
import { z as z8 } from "zod";

// packages/plugin-local/src/tools.ts
async function resolveRoot(ctl, configuredDir) {
  const dir = (configuredDir ?? "").trim();
  if (dir) {
    const expanded = dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
    return resolve2(expanded);
  }
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
  const root = await resolveRoot(ctl, chat.get("workingDir"));
  const tools = createFsTools({ root });
  if (chat.get("enableShell")) {
    tools.push(
      createShellTool({
        cwd: root,
        timeoutMs: chat.get("commandTimeoutMs"),
        policy: {
          allow: chat.get("shellAllow"),
          deny: chat.get("shellDeny")
        }
      })
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
