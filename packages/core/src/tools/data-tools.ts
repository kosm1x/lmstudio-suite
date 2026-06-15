/**
 * SDK `tool()` builders for deterministic data + math: a calculator, JSON and
 * CSV readers, and read-only SQLite queries. The point is to stop the model
 * doing arithmetic and data-wrangling in its head — give it exact answers.
 *
 * File inputs are scoped through `ScopedFs` (same path guard as local-tools).
 * `query_sqlite` uses the built-in `node:sqlite` (Node ≥22), opened read-only;
 * it degrades to a clear error if the runtime lacks that module.
 */
import { tool, type Tool } from "@lmstudio/sdk";
import { z } from "zod";
import { ScopedFs } from "../fs/index";
import {
  evalArithmetic,
  toTable,
  aggregate,
  queryJsonPath,
  checkReadOnlySql,
  type AggregateOp,
} from "../data/index";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Rows returned by query_sqlite / shown by read_csv are capped to keep output model-sized. */
const SQLITE_MAX_ROWS = 100;
const CSV_MAX_ROWS = 100;
/** Whole-file readers (CSV/JSON) refuse inputs larger than this, to bound memory. */
const MAX_INPUT_BYTES = 25_000_000;

/** Read a scoped text file, refusing anything over MAX_INPUT_BYTES. */
async function readBoundedFile(fs: ScopedFs, rel: string): Promise<string> {
  const info = await fs.stat(rel); // throws ENOENT if missing
  if (info.size > MAX_INPUT_BYTES) {
    throw new Error(
      `${rel} is too large (${info.size} bytes; limit ${MAX_INPUT_BYTES})`,
    );
  }
  return fs.readFileFull(rel);
}

export interface DataToolsOptions {
  /** Root directory that file inputs (CSV / JSON / .db) are scoped to. */
  root: string;
  /** Override the SQLite opener (tests inject; default uses node:sqlite). */
  openSqlite?: (absPath: string) => SqliteReader;
}

/** The slice of node:sqlite's DatabaseSync we use. */
export interface SqliteReader {
  prepare(sql: string): { iterate(): IterableIterator<unknown> };
  close(): void;
}

async function defaultOpenSqlite(absPath: string): Promise<SqliteReader> {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(absPath, {
    readOnly: true,
  }) as unknown as SqliteReader;
}

export function createDataTools(options: DataToolsOptions): Tool[] {
  const fs = new ScopedFs(options.root);

  return [
    tool({
      name: "calculator",
      description:
        "Evaluate an arithmetic expression exactly and return the number. Supports " +
        "+ - * / % ^ (power), parentheses, unary minus, and decimal/scientific numbers. " +
        "Use this instead of computing in your head. No variables or functions.",
      parameters: {
        expression: z
          .string()
          .describe("Arithmetic expression, e.g. '(3 + 4) * 2 ^ 3'."),
      },
      implementation: async ({ expression }, { status }) => {
        status(`= ${expression}`);
        try {
          return String(evalArithmetic(expression));
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "parse_json",
      description:
        "Read a value out of JSON — from a file in the working directory or an inline " +
        "string — using a jq-lite path like '.users[0].name' or 'data[\"key\"]'. Returns " +
        "the selected value as JSON. Omit the path (or pass '.') to return the whole document.",
      parameters: {
        path: z
          .string()
          .default(".")
          .describe(
            "JSON path to extract, e.g. '.items[2].id'. '.' = the whole document.",
          ),
        file: z
          .string()
          .optional()
          .describe("Relative path to a .json file to read."),
        json: z
          .string()
          .optional()
          .describe("Inline JSON string (used when 'file' is not given)."),
      },
      implementation: async ({ path, file, json }, { status, warn }) => {
        status("parse_json");
        try {
          let text: string;
          if (file) text = await readBoundedFile(fs, file);
          else if (json !== undefined) text = json;
          else return "Error: provide either 'file' or 'json'.";
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            return `Error: invalid JSON: ${msg(err)}`;
          }
          const value = queryJsonPath(parsed, path);
          if (value === undefined) return `No value at path '${path}'.`;
          return JSON.stringify(value, null, 2);
        } catch (err) {
          warn(`parse_json failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "read_csv",
      description:
        "Read a CSV file from the working directory: preview rows, select columns, filter " +
        "by an exact column value, or compute one aggregate (count/sum/avg/min/max). " +
        "Handles quoted fields. Row output is capped — use a filter or aggregate on large files.",
      parameters: {
        file: z.string().describe("Relative path to the .csv file."),
        columns: z
          .array(z.string())
          .optional()
          .describe("Subset of column names to return (default: all)."),
        filter_column: z
          .string()
          .optional()
          .describe("Column to filter on (exact match against filter_value)."),
        filter_value: z
          .string()
          .optional()
          .describe("Value the filter_column must equal."),
        aggregate: z
          .enum(["count", "sum", "avg", "min", "max"])
          .optional()
          .describe("Compute this aggregate instead of returning rows."),
        aggregate_column: z
          .string()
          .optional()
          .describe("Numeric column for sum/avg/min/max."),
      },
      implementation: async (
        {
          file,
          columns,
          filter_column,
          filter_value,
          aggregate: aggOp,
          aggregate_column,
        },
        { status, warn },
      ) => {
        status(`read_csv ${file}`);
        try {
          const table = toTable(await readBoundedFile(fs, file));
          if (table.header.length === 0) return "(empty CSV)";

          // Optional exact-match filter.
          let rows = table.rows;
          if (filter_column) {
            const fi = table.header.indexOf(filter_column);
            if (fi < 0) return `Error: no such column: ${filter_column}`;
            rows = rows.filter((r) => r[fi] === filter_value);
          }

          if (aggOp) {
            const value = aggregate(
              { header: table.header, rows },
              aggOp as AggregateOp,
              aggregate_column,
            );
            return `${aggOp}${aggregate_column ? `(${aggregate_column})` : ""} = ${value}`;
          }

          // Optional column projection.
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
              `…[${projected.length - CSV_MAX_ROWS} more rows; ${projected.length} total]`,
            );
          }
          return lines.join("\n");
        } catch (err) {
          warn(`read_csv failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      },
    }),
    tool({
      name: "query_sqlite",
      description:
        "Run a READ-ONLY SQL query (SELECT / WITH only) against a SQLite .db file in the " +
        "working directory and return the rows as JSON. Writes are refused. Row output is " +
        "capped. Use this for precise lookups/joins/aggregates over local databases.",
      parameters: {
        file: z.string().describe("Relative path to the SQLite .db file."),
        query: z.string().describe("A single SELECT or WITH statement."),
      },
      implementation: async ({ file, query }, { status, warn }) => {
        status("query_sqlite");
        const check = checkReadOnlySql(query);
        if (!check.ok) return `Error: ${check.reason}.`;
        let abs: string;
        try {
          abs = fs.resolvePath(file);
        } catch (err) {
          return `Error: ${msg(err)}`;
        }
        if (!(await fs.exists(file))) return `Error: no such file: ${file}`;
        let db: SqliteReader;
        try {
          db = options.openSqlite
            ? options.openSqlite(abs)
            : await defaultOpenSqlite(abs);
        } catch (err) {
          return `Error: cannot open SQLite database (is node:sqlite available?): ${msg(err)}`;
        }
        try {
          // Stream rows and stop at the cap, so a `SELECT *` over a huge table
          // never materializes the whole result set in memory.
          const rows: unknown[] = [];
          let hasMore = false;
          for (const row of db.prepare(query).iterate()) {
            if (rows.length >= SQLITE_MAX_ROWS) {
              hasMore = true;
              break;
            }
            rows.push(row);
          }
          const body = JSON.stringify(rows, null, 2);
          return hasMore
            ? `${body}\n…[showing the first ${SQLITE_MAX_ROWS} rows; more exist]`
            : body;
        } catch (err) {
          warn(`query_sqlite failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        } finally {
          try {
            db.close();
          } catch {
            /* ignore close errors */
          }
        }
      },
    }),
  ];
}
