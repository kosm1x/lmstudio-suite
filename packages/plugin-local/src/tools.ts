/**
 * Filesystem + shell tools, scoped to the prediction's working directory.
 * Backed by @lmstudio-suite/core (ScopedFs + runShell).
 */
import { tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs, runShell } from "@lmstudio-suite/core";
import { chatConfigSchematics } from "./config";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export async function toolsProvider(
  ctl: ToolsProviderController,
): Promise<Tool[]> {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const enableShell = chat.get("enableShell");
  const commandTimeoutMs = chat.get("commandTimeoutMs");

  const root = ctl.getWorkingDirectory();
  const fs = new ScopedFs(root);

  const tools: Tool[] = [
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

  if (enableShell) {
    tools.push(
      tool({
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
            cwd: root,
            timeoutMs: commandTimeoutMs,
            signal,
          });
          if (r.timedOut)
            warn(`run_shell timed out after ${commandTimeoutMs}ms`);
          const parts = [`exit: ${r.timedOut ? "timed out" : r.exitCode}`];
          if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
          if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
          return parts.join("\n\n");
        },
      }),
    );
  }

  return tools;
}
