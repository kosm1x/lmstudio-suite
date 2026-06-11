/**
 * SDK `tool()` builders for filesystem + shell access, shared by the local-tools
 * plugin and the agent CLI. Filesystem access is scoped to `root`.
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs } from "../fs/index";
import { runShell } from "../exec/index";

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
  ];
}

export interface ShellToolOptions {
  /** Working directory for executed commands. */
  cwd: string;
  /** Kill commands after this many ms (default 30000). */
  timeoutMs?: number;
}

export function createShellTool(options: ShellToolOptions): Tool {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return tool({
    name: "run_shell",
    description:
      "Run a shell command in the working directory and return its exit code, stdout, and stderr. " +
      "Use for builds, tests, git, or file tooling.",
    parameters: {
      command: z.string().describe("The shell command line to execute."),
    },
    implementation: async ({ command }, { status, warn, signal }) => {
      status(`$ ${command}`);
      const r = await runShell(command, {
        cwd: options.cwd,
        timeoutMs,
        signal,
      });
      if (r.timedOut) warn(`run_shell timed out after ${timeoutMs}ms`);
      const parts = [`exit: ${r.timedOut ? "timed out" : r.exitCode}`];
      if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
      if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
      return parts.join("\n\n");
    },
  });
}
