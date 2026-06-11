/** Per-chat config for the local-tools plugin. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const chatConfigSchematics = createConfigSchematics()
  .field(
    "workingDir",
    "string",
    {
      displayName: "Working directory",
      hint: "Absolute path the file/shell tools operate in (e.g. your project folder). Supports a leading ~. Leave blank to use the chat's auto working directory, falling back to a temp sandbox.",
      placeholder: "~/projects/my-app",
    },
    "",
  )
  .field(
    "enableShell",
    "boolean",
    {
      displayName: "Enable run_shell",
      hint: "Let the model run shell commands in the prediction's working directory. Off by default.",
      warning:
        "run_shell executes commands with your user account's privileges. It is resource-bounded " +
        "(timeout + output cap) but is NOT a security sandbox. Only enable for trusted models/tasks.",
    },
    false,
  )
  .field(
    "commandTimeoutMs",
    "numeric",
    {
      displayName: "Shell command timeout (ms)",
      hint: "run_shell kills any command that runs longer than this.",
      int: true,
      min: 1_000,
      max: 600_000,
    },
    30_000,
  )
  .build();
