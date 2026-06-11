/** Per-chat config for the local-tools plugin. */
import { createConfigSchematics } from "@lmstudio/sdk";

export const chatConfigSchematics = createConfigSchematics()
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
