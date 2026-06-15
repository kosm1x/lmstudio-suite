// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-data. Do not edit; regenerate instead.

// packages/plugin-data/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var chatConfigSchematics = createConfigSchematics().field(
  "workingDir",
  "string",
  {
    displayName: "Working directory",
    hint: "Absolute path the data tools read files from (CSV / JSON / .db). Supports a leading ~. Leave blank to use the chat's auto working directory, falling back to a temp sandbox.",
    placeholder: "~/data"
  },
  ""
).build();

// packages/plugin-data/src/tools.ts
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

// packages/core/src/data/calc.ts
var NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if ("+-*/%^()".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    const m = NUMBER_RE.exec(expr.slice(i));
    if (m) {
      const num = Number(m[0]);
      if (!Number.isFinite(num)) throw new Error(`invalid number '${m[0]}'`);
      tokens.push({ type: "number", value: m[0], num });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected character '${c}'`);
  }
  return tokens;
}
function evalArithmetic(expr) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek() && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm() {
    let v = parseUnary();
    while (peek() && ["*", "/", "%"].includes(peek().value)) {
      const op = next().value;
      const rhs = parseUnary();
      if (op === "*") v *= rhs;
      else if (op === "/") v /= rhs;
      else v %= rhs;
    }
    return v;
  }
  function parseUnary() {
    if (peek()?.value === "-") {
      next();
      return -parseUnary();
    }
    if (peek()?.value === "+") {
      next();
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower() {
    const base = parsePrimary();
    if (peek()?.value === "^") {
      next();
      return Math.pow(base, parseUnary());
    }
    return base;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.type === "number") {
      next();
      return t.num;
    }
    if (t.value === "(") {
      next();
      const v = parseExpr();
      if (peek()?.value !== ")") throw new Error("missing closing ')'");
      next();
      return v;
    }
    throw new Error(`unexpected token '${t.value}'`);
  }
  if (tokens.length === 0) throw new Error("empty expression");
  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`unexpected token '${peek().value}'`);
  }
  if (!Number.isFinite(result))
    throw new Error("result is not a finite number");
  return result;
}

// packages/core/src/data/csv.ts
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      endField();
      i++;
    } else if (c === "\n") {
      endRow();
      i++;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
function toTable(text) {
  const all = parseCsv(text);
  const header = all[0] ?? [];
  return { header, rows: all.slice(1) };
}
function aggregate(table, op, column) {
  if (op === "count") return table.rows.length;
  if (!column) throw new Error(`${op} requires a column`);
  const idx = table.header.indexOf(column);
  if (idx < 0) throw new Error(`no such column: ${column}`);
  const nums = table.rows.map((r) => Number(r[idx])).filter((x) => Number.isFinite(x));
  if (nums.length === 0)
    throw new Error(`column ${column} has no numeric values`);
  switch (op) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return nums.reduce((a, b) => b < a ? b : a);
    case "max":
      return nums.reduce((a, b) => b > a ? b : a);
  }
}

// packages/core/src/data/jsonpath.ts
function parseJsonPath(path) {
  const segments = [];
  let i = 0;
  const s = path.trim();
  if (s[i] === "$") i++;
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) throw new Error("unclosed '[' in path");
      let inner = s.slice(i + 1, close).trim();
      if (inner.startsWith('"') && inner.endsWith('"') || inner.startsWith("'") && inner.endsWith("'")) {
        segments.push(inner.slice(1, -1));
      } else if (/^-?\d+$/.test(inner)) {
        segments.push(Number(inner));
      } else if (inner.length > 0) {
        segments.push(inner);
      }
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    const key = s.slice(i, j);
    if (key.length > 0) segments.push(key);
    i = j;
  }
  return segments;
}
function queryJsonPath(root, path) {
  const segments = parseJsonPath(path);
  let cur = root;
  for (const seg of segments) {
    if (cur == null) return void 0;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return void 0;
      cur = cur[seg < 0 ? cur.length + seg : seg];
    } else {
      if (typeof cur !== "object") return void 0;
      cur = cur[seg];
    }
  }
  return cur;
}

// packages/core/src/data/sql-readonly.ts
var FORBIDDEN = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "ATTACH",
  "DETACH",
  "REINDEX",
  "VACUUM",
  "PRAGMA"
];
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}
function stripStrings(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}
function checkReadOnlySql(sql) {
  const cleaned = stripStrings(stripComments(sql)).trim();
  if (cleaned.length === 0) return { ok: false, reason: "empty query" };
  const withoutTrailing = cleaned.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    return { ok: false, reason: "only a single statement is allowed" };
  }
  if (!/^(select|with)\b/i.test(withoutTrailing)) {
    return { ok: false, reason: "only SELECT / WITH queries are allowed" };
  }
  const upper = withoutTrailing.toUpperCase();
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`).test(upper)) {
      return { ok: false, reason: `statement contains a write keyword: ${kw}` };
    }
  }
  return { ok: true };
}

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/http-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool3 } from "@lmstudio/sdk";
import { z as z3 } from "zod";

// packages/core/src/tools/map-tools.ts
import { tool as tool4 } from "@lmstudio/sdk";
import { z as z4 } from "zod";

// packages/core/src/tools/data-tools.ts
import { tool as tool5 } from "@lmstudio/sdk";
import { z as z5 } from "zod";
var msg = (err) => err instanceof Error ? err.message : String(err);
var SQLITE_MAX_ROWS = 100;
var CSV_MAX_ROWS = 100;
var MAX_INPUT_BYTES = 25e6;
async function readBoundedFile(fs, rel) {
  const info = await fs.stat(rel);
  if (info.size > MAX_INPUT_BYTES) {
    throw new Error(
      `${rel} is too large (${info.size} bytes; limit ${MAX_INPUT_BYTES})`
    );
  }
  return fs.readFileFull(rel);
}
async function defaultOpenSqlite(absPath) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(absPath, {
    readOnly: true
  });
}
function createDataTools(options) {
  const fs = new ScopedFs(options.root);
  return [
    tool5({
      name: "calculator",
      description: "Evaluate an arithmetic expression exactly and return the number. Supports + - * / % ^ (power), parentheses, unary minus, and decimal/scientific numbers. Use this instead of computing in your head. No variables or functions.",
      parameters: {
        expression: z5.string().describe("Arithmetic expression, e.g. '(3 + 4) * 2 ^ 3'.")
      },
      implementation: async ({ expression }, { status }) => {
        status(`= ${expression}`);
        try {
          return String(evalArithmetic(expression));
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool5({
      name: "parse_json",
      description: `Read a value out of JSON \u2014 from a file in the working directory or an inline string \u2014 using a jq-lite path like '.users[0].name' or 'data["key"]'. Returns the selected value as JSON. Omit the path (or pass '.') to return the whole document.`,
      parameters: {
        path: z5.string().default(".").describe(
          "JSON path to extract, e.g. '.items[2].id'. '.' = the whole document."
        ),
        file: z5.string().optional().describe("Relative path to a .json file to read."),
        json: z5.string().optional().describe("Inline JSON string (used when 'file' is not given).")
      },
      implementation: async ({ path, file, json }, { status, warn }) => {
        status("parse_json");
        try {
          let text;
          if (file) text = await readBoundedFile(fs, file);
          else if (json !== void 0) text = json;
          else return "Error: provide either 'file' or 'json'.";
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            return `Error: invalid JSON: ${msg(err)}`;
          }
          const value = queryJsonPath(parsed, path);
          if (value === void 0) return `No value at path '${path}'.`;
          return JSON.stringify(value, null, 2);
        } catch (err) {
          warn(`parse_json failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool5({
      name: "read_csv",
      description: "Read a CSV file from the working directory: preview rows, select columns, filter by an exact column value, or compute one aggregate (count/sum/avg/min/max). Handles quoted fields. Row output is capped \u2014 use a filter or aggregate on large files.",
      parameters: {
        file: z5.string().describe("Relative path to the .csv file."),
        columns: z5.array(z5.string()).optional().describe("Subset of column names to return (default: all)."),
        filter_column: z5.string().optional().describe("Column to filter on (exact match against filter_value)."),
        filter_value: z5.string().optional().describe("Value the filter_column must equal."),
        aggregate: z5.enum(["count", "sum", "avg", "min", "max"]).optional().describe("Compute this aggregate instead of returning rows."),
        aggregate_column: z5.string().optional().describe("Numeric column for sum/avg/min/max.")
      },
      implementation: async ({
        file,
        columns,
        filter_column,
        filter_value,
        aggregate: aggOp,
        aggregate_column
      }, { status, warn }) => {
        status(`read_csv ${file}`);
        try {
          const table = toTable(await readBoundedFile(fs, file));
          if (table.header.length === 0) return "(empty CSV)";
          let rows = table.rows;
          if (filter_column) {
            const fi = table.header.indexOf(filter_column);
            if (fi < 0) return `Error: no such column: ${filter_column}`;
            rows = rows.filter((r) => r[fi] === filter_value);
          }
          if (aggOp) {
            const value = aggregate(
              { header: table.header, rows },
              aggOp,
              aggregate_column
            );
            return `${aggOp}${aggregate_column ? `(${aggregate_column})` : ""} = ${value}`;
          }
          let header = table.header;
          let projected = rows;
          if (columns && columns.length > 0) {
            const idxs = columns.map((c) => {
              const i = table.header.indexOf(c);
              if (i < 0) throw new Error(`no such column: ${c}`);
              return i;
            });
            header = columns;
            projected = rows.map((r) => idxs.map((i) => r[i] ?? ""));
          }
          const shown = projected.slice(0, CSV_MAX_ROWS);
          const lines = [header.join(" | ")];
          for (const r of shown) lines.push(r.join(" | "));
          if (projected.length > CSV_MAX_ROWS) {
            lines.push(
              `\u2026[${projected.length - CSV_MAX_ROWS} more rows; ${projected.length} total]`
            );
          }
          return lines.join("\n");
        } catch (err) {
          warn(`read_csv failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool5({
      name: "query_sqlite",
      description: "Run a READ-ONLY SQL query (SELECT / WITH only) against a SQLite .db file in the working directory and return the rows as JSON. Writes are refused. Row output is capped. Use this for precise lookups/joins/aggregates over local databases.",
      parameters: {
        file: z5.string().describe("Relative path to the SQLite .db file."),
        query: z5.string().describe("A single SELECT or WITH statement.")
      },
      implementation: async ({ file, query }, { status, warn }) => {
        status("query_sqlite");
        const check = checkReadOnlySql(query);
        if (!check.ok) return `Error: ${check.reason}.`;
        let abs;
        try {
          abs = fs.resolvePath(file);
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
        if (!await fs.exists(file)) return `Error: no such file: ${file}`;
        let db;
        try {
          db = options.openSqlite ? options.openSqlite(abs) : await defaultOpenSqlite(abs);
        } catch (err) {
          return `Error: cannot open SQLite database (is node:sqlite available?): ${msg(err)}`;
        }
        try {
          const rows = [];
          let hasMore = false;
          for (const row of db.prepare(query).iterate()) {
            if (rows.length >= SQLITE_MAX_ROWS) {
              hasMore = true;
              break;
            }
            rows.push(row);
          }
          const body = JSON.stringify(rows, null, 2);
          return hasMore ? `${body}
\u2026[showing the first ${SQLITE_MAX_ROWS} rows; more exist]` : body;
        } catch (err) {
          warn(`query_sqlite failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        } finally {
          try {
            db.close();
          } catch {
          }
        }
      }
    })
  ];
}

// packages/core/src/tools/memory-tools.ts
import { tool as tool6 } from "@lmstudio/sdk";
import { z as z6 } from "zod";

// packages/plugin-data/src/tools.ts
async function resolveRoot(ctl, configuredDir) {
  const dir = (configuredDir ?? "").trim();
  if (dir) {
    const expanded = dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
    return resolve2(expanded);
  }
  try {
    return ctl.getWorkingDirectory();
  } catch {
    const fallback = join(tmpdir(), "lmstudio-data-tools");
    await mkdir(fallback, { recursive: true }).catch(() => {
    });
    return fallback;
  }
}
async function toolsProvider(ctl) {
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const root = await resolveRoot(ctl, chat.get("workingDir"));
  return createDataTools({ root });
}

// packages/plugin-data/src/index.ts
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withToolsProvider(toolsProvider);
}
export {
  main
};
