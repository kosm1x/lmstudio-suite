# local-tools

Give a local model a **filesystem and shell**, scoped to the prediction's working directory — turn a chat model into a lightweight coding/file agent.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Tools

| Tool         | What it does                                                                           |
| ------------ | -------------------------------------------------------------------------------------- |
| `read_file`  | Read a UTF-8 text file (paths relative to the working dir; `..` escapes rejected).     |
| `write_file` | Create/overwrite a file, creating parent directories.                                  |
| `edit_file`  | Surgical exact-string replace (unique match by default; `replace_all` for renames).    |
| `list_dir`   | List files and subdirectories.                                                         |
| `run_shell`  | Run a shell command and return exit code + stdout/stderr. **Opt-in** (off by default). |

## Working directory

Set **Working directory** in the plugin config to the folder you want the tools to operate in — e.g. `~/projects/my-app` (a leading `~` is expanded). All paths are then relative to it, and `..` escapes are rejected. This is how you point the tools at your real project.

If left blank, it uses LM Studio's auto per-chat working directory, falling back to a temp sandbox (`<tmp>/lmstudio-local-tools`) — so the tools always load, but won't see your project until you set the directory.

## Configuration (per-chat)

- **Enable run_shell** — off by default. When on, the model can run shell commands in the working directory.
- **Shell command timeout (ms)** — commands are killed past this (default 30000).

## Safety

File access is confined to the working directory by a path-traversal guard. `run_shell` is **resource-bounded** (timeout, output cap, scoped cwd) but **not a security sandbox** — a command runs with your user account's privileges. Leave `run_shell` off unless you trust the model and the task.

MIT licensed.
