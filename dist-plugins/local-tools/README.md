# local-tools

Give a local model a **filesystem and shell**, scoped to the prediction's working directory — turn a chat model into a lightweight coding/file agent.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Tools

| Tool         | What it does                                                                           |
| ------------ | -------------------------------------------------------------------------------------- |
| `read_file`  | Read a UTF-8 text file (paths relative to the working dir; `..` escapes rejected).     |
| `write_file` | Create/overwrite a file, creating parent directories.                                  |
| `list_dir`   | List files and subdirectories.                                                         |
| `run_shell`  | Run a shell command and return exit code + stdout/stderr. **Opt-in** (off by default). |

## Working directory

The tools operate on the **folder attached to the chat**. If the chat has no folder attached, they fall back to a temp sandbox (`<tmp>/lmstudio-local-tools`) so they still work — attach a folder to the chat to read/write your real files there.

## Configuration (per-chat)

- **Enable run_shell** — off by default. When on, the model can run shell commands in the working directory.
- **Shell command timeout (ms)** — commands are killed past this (default 30000).

## Safety

File access is confined to the working directory by a path-traversal guard. `run_shell` is **resource-bounded** (timeout, output cap, scoped cwd) but **not a security sandbox** — a command runs with your user account's privileges. Leave `run_shell` off unless you trust the model and the task.

MIT licensed.
