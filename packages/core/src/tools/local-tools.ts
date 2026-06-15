/**
 * SDK `tool()` builders for filesystem + shell access, shared by the local-tools
 * plugin and the agent CLI. Filesystem access is scoped to `root`.
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs, globToRegExp } from "../fs/index";
import {
  runShell,
  checkCommandPolicy,
  type CommandPolicy,
} from "../exec/index";

/** Caps for the recursive search/glob tools, to keep output model-sized. */
const SEARCH_MAX_MATCHES = 200;
const SEARCH_MAX_FILE_BYTES = 2_000_000;
const GLOB_MAX_RESULTS = 500;

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export interface FsToolsOptions {
  /** Root directory that all file operations are scoped to. */
  root: string;
}

export function createFsTools(options: FsToolsOptions): Tool[] {
  const fs = new ScopedFs(options.root);
  return [
    tool({
      name: "read_file",
      description:
        "Read a UTF-8 text file. Paths are relative to the working directory; '..' escapes are rejected.",
      parameters: {
        path: z.string().describe("Relative path of the file to read."),
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
      },
    }),
    tool({
      name: "write_file",
      description:
        "Create or overwrite a UTF-8 text file (parent directories are created). Paths are relative to the working directory.",
      parameters: {
        path: z.string().describe("Relative destination path."),
        content: z.string().describe("The full file contents to write."),
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
      },
    }),
    tool({
      name: "edit_file",
      description:
        "Make a surgical edit to an existing text file: replace an exact substring with new " +
        "text, without rewriting the whole file. By default old_string must match EXACTLY " +
        "ONCE — include enough surrounding context (indentation, adjacent lines) to make it " +
        "unique. Set replace_all to change every occurrence (e.g. renaming a symbol). The " +
        "edit fails WITHOUT writing if old_string is empty, missing, equal to new_string, or " +
        "(when replace_all is off) ambiguous. Matching is literal — no regex, no $ escapes. " +
        "Paths are relative to the working directory; '..' escapes are rejected.",
      parameters: {
        path: z.string().describe("Relative path of the file to edit."),
        old_string: z
          .string()
          .describe(
            "Exact text to find. Must match once unless replace_all is set.",
          ),
        new_string: z.string().describe("Text to replace it with."),
        replace_all: z
          .boolean()
          .default(false)
          .describe(
            "Replace every occurrence instead of requiring a unique match.",
          ),
      },
      implementation: async (
        { path, old_string, new_string, replace_all },
        { status, warn },
      ) => {
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
          const after = replace_all
            ? before.split(old_string).join(new_string)
            : before.slice(0, idx) +
              new_string +
              before.slice(idx + old_string.length);
          await fs.writeFile(path, after);
          const n = replace_all ? occurrences : 1;
          return `Edited ${path}: replaced ${n} occurrence${n === 1 ? "" : "s"}. (${before.length} → ${after.length} chars)`;
        } catch (err) {
          const m = msg(err);
          warn(`edit_file failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
    tool({
      name: "list_dir",
      description:
        "List the files and subdirectories of a directory. Paths are relative to the working directory; use '.' for the root.",
      parameters: {
        path: z
          .string()
          .default(".")
          .describe("Relative directory path (defaults to '.')."),
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Listing ${path}`);
        try {
          const entries = await fs.list(path);
          if (entries.length === 0) return "(empty directory)";
          return entries
            .map((e) => `${e.type === "dir" ? "[dir] " : "      "}${e.name}`)
            .join("\n");
        } catch (err) {
          const m = msg(err);
          warn(`list_dir failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
    tool({
      name: "search_files",
      description:
        "Search file CONTENTS for a regular expression, recursively under the working " +
        "directory (.git and node_modules are skipped, binary files ignored). Returns " +
        "matching lines as `path:line: text`. Optionally restrict to files matching a " +
        "glob. Use this to find where something is defined or used before reading whole " +
        "files. Output is capped — narrow the pattern or glob if you see a truncation marker.",
      parameters: {
        pattern: z
          .string()
          .describe(
            "Regular expression to search for (JavaScript regex syntax).",
          ),
        glob: z
          .string()
          .optional()
          .describe(
            "Only search files whose path matches this glob (e.g. '**/*.ts').",
          ),
        path: z
          .string()
          .default(".")
          .describe("Subdirectory to search under (default '.')."),
        ignore_case: z
          .boolean()
          .default(false)
          .describe("Case-insensitive match."),
      },
      implementation: async (
        { pattern, glob, path, ignore_case },
        { status, warn },
      ) => {
        status(`Searching for /${pattern}/`);
        let re: RegExp;
        try {
          re = new RegExp(pattern, ignore_case ? "i" : "");
        } catch (err) {
          return `Error: invalid regular expression: ${msg(err)}`;
        }
        const globRe = glob ? globToRegExp(glob) : null;
        // Match the glob against the path relative to `path` (the search base),
        // exactly as the `glob` tool does — otherwise the same glob would mean
        // different things in the two tools.
        const base = path === "." ? "" : path.replace(/\/+$/, "") + "/";
        const out: string[] = [];
        let truncated = false;
        try {
          outer: for await (const rel of fs.walk(path)) {
            if (globRe) {
              const relBase =
                base && rel.startsWith(base) ? rel.slice(base.length) : rel;
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
            if (content.includes("\u0000")) continue; // skip binary
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i] as string)) {
                out.push(
                  `${rel}:${i + 1}: ${(lines[i] as string).trim().slice(0, 300)}`,
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
        return (
          out.join("\n") +
          (truncated ? `\n…[truncated at ${SEARCH_MAX_MATCHES} matches]` : "")
        );
      },
    }),
    tool({
      name: "glob",
      description:
        "List files whose path matches a glob pattern (e.g. '**/*.ts', " +
        "'src/**/*.test.ts'), recursively under the working directory (.git and " +
        "node_modules skipped). Supports *, ?, and ** (crossing directories). Returns " +
        "matching paths, sorted. Use to discover files by name/extension before reading.",
      parameters: {
        pattern: z
          .string()
          .describe("Glob pattern to match against file paths."),
        path: z
          .string()
          .default(".")
          .describe(
            "Subdirectory to search under (default '.'); the pattern matches paths relative to it.",
          ),
      },
      implementation: async ({ pattern, path }, { status, warn }) => {
        status(`Globbing ${pattern}`);
        const globRe = globToRegExp(pattern);
        const base = path === "." ? "" : path.replace(/\/+$/, "") + "/";
        const hits: string[] = [];
        let truncated = false;
        try {
          for await (const rel of fs.walk(path)) {
            const relBase =
              base && rel.startsWith(base) ? rel.slice(base.length) : rel;
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
        return (
          hits.join("\n") +
          (truncated ? `\n…[truncated at ${GLOB_MAX_RESULTS}]` : "")
        );
      },
    }),
    tool({
      name: "move_file",
      description:
        "Move or rename a file or directory within the working directory. Both paths " +
        "are relative; '..' escapes are rejected. Missing parent directories of the " +
        "destination are created, and an existing destination is overwritten.",
      parameters: {
        from: z.string().describe("Existing relative path."),
        to: z.string().describe("New relative path."),
      },
      implementation: async ({ from, to }, { status, warn }) => {
        status(`Moving ${from} → ${to}`);
        try {
          await fs.move(from, to);
          return `Moved ${from} → ${to}.`;
        } catch (err) {
          const m = msg(err);
          warn(`move_file failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
    tool({
      name: "delete_file",
      description:
        "Delete a file, or a directory and all its contents, within the working " +
        "directory. Relative paths only; '..' escapes are rejected; refuses to delete " +
        "the root itself. Irreversible — there is no trash.",
      parameters: {
        path: z.string().describe("Relative path to delete."),
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Deleting ${path}`);
        try {
          if (!(await fs.exists(path))) return `Error: ${path} does not exist.`;
          await fs.remove(path);
          return `Deleted ${path}.`;
        } catch (err) {
          const m = msg(err);
          warn(`delete_file failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
    tool({
      name: "make_dir",
      description:
        "Create a directory (and any missing parents) within the working directory. " +
        "Relative paths only; '..' escapes are rejected.",
      parameters: {
        path: z.string().describe("Relative directory path to create."),
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
      },
    }),
    tool({
      name: "stat_path",
      description:
        "Report whether a path exists and whether it is a file or directory, with its " +
        "size in bytes and last-modified time. Relative paths only.",
      parameters: {
        path: z.string().describe("Relative path to inspect."),
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Stat ${path}`);
        try {
          const s = await fs.stat(path);
          return `${path}: ${s.type}, ${s.size} bytes, modified ${new Date(s.mtimeMs).toISOString()}`;
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT")
            return `${path}: does not exist.`;
          const m = msg(err);
          warn(`stat_path failed: ${m}`);
          return `Error: ${m}`;
        }
      },
    }),
  ];
}

export interface ShellToolOptions {
  /** Working directory for executed commands. */
  cwd: string;
  /** Kill commands after this many ms (default 30000). */
  timeoutMs?: number;
  /** Cap on captured stdout/stderr bytes each (default 100000). */
  maxOutputBytes?: number;
  /**
   * Optional allow/deny command policy (a guardrail, not a sandbox). When set,
   * a violating command is refused before it runs.
   */
  policy?: CommandPolicy;
}

export function createShellTool(options: ShellToolOptions): Tool {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const policy = options.policy ?? {};
  return tool({
    name: "run_shell",
    description:
      "Run a shell command in the working directory and return its exit code, stdout, and stderr. " +
      "Use for builds, tests, git, or file tooling. The operator may restrict which commands are " +
      "allowed; a blocked command is refused without running.",
    parameters: {
      command: z.string().describe("The shell command line to execute."),
    },
    implementation: async ({ command }, { status, warn, signal }) => {
      const denial = checkCommandPolicy(command, policy);
      if (denial) {
        warn(`run_shell refused: ${denial}`);
        return `Error: command refused by policy — ${denial}.`;
      }
      status(`$ ${command}`);
      const r = await runShell(command, {
        cwd: options.cwd,
        timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        signal,
      });
      if (r.timedOut) warn(`run_shell timed out after ${timeoutMs}ms`);
      const parts = [`exit: ${r.timedOut ? "timed out" : r.exitCode}`];
      if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
      if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
      if (r.truncated) parts.push("[output truncated at the byte cap]");
      return parts.join("\n\n");
    },
  });
}
