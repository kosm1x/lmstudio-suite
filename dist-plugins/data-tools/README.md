# data-tools

Give a local model **deterministic data + math** — so it stops doing arithmetic in its head and eyeballing tables. Calculator, JSON/CSV readers, and read-only SQLite, scoped to a working directory.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Tools

| Tool           | What it does                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `calculator`   | Evaluate an arithmetic expression exactly (`+ - * / % ^`, parens, unary, decimals). No `eval`.    |
| `parse_json`   | Read a value out of a JSON file or string with a jq-lite path (`.users[0].name`).                 |
| `read_csv`     | Preview / project columns / filter / aggregate (count·sum·avg·min·max) a CSV. Handles quotes.     |
| `query_sqlite` | Run a **read-only** SQL query (`SELECT` / `WITH`) over a `.db` file. Writes refused. Rows capped. |

## Working directory

Set **Working directory** in the plugin config to the folder holding your data files (CSV / JSON / `.db`). All file paths are then relative to it, and `..` escapes are rejected. Leave blank to use LM Studio's auto per-chat directory, falling back to a temp sandbox.

## Notes

- `query_sqlite` uses Node's built-in `node:sqlite` (Node ≥22) and opens the database **read-only** at the engine level; the query is also pre-checked to be `SELECT` / `WITH` only. If the runtime lacks `node:sqlite`, the tool returns a clear error instead of crashing.
- Output is capped (100 rows for CSV/SQLite) to stay within the model's context — use a filter or aggregate on large files.

MIT licensed.
