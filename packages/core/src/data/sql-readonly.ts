/**
 * Read-only SQL guard for query_sqlite.
 *
 * Defense in depth: the connection is opened with SQLite's `readOnly` flag
 * (the engine itself rejects writes), and this guard adds a cheap pre-check so
 * the model gets a clear "read-only" message instead of a driver error, and so
 * obviously-mutating statements never reach the driver. Belt and suspenders —
 * neither layer is trusted alone.
 */
// `REPLACE` is intentionally absent: it is a scalar function (`replace(...)`),
// and the write form `REPLACE INTO` is already rejected by the SELECT/WITH
// start-check below. Keeping it here would block legitimate `select replace(...)`.
const FORBIDDEN = [
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
  "PRAGMA",
];

/** Strip SQL line comments (double-dash) and C-style block comments. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Blank out string literals so their contents can't trip the `;` (multi-
 * statement) or keyword scans — e.g. `where name = 'DROP'` or `'a;b'`. Handles
 * SQLite single-quoted strings (with `''` escape) and double-quoted identifiers.
 */
function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

export interface SqlCheck {
  ok: boolean;
  reason?: string;
}

export function checkReadOnlySql(sql: string): SqlCheck {
  // Strip comments first, then string literals, so neither can smuggle a `;`
  // or a write keyword past the scans below.
  const cleaned = stripStrings(stripComments(sql)).trim();
  if (cleaned.length === 0) return { ok: false, reason: "empty query" };

  // Reject multiple statements (anything after a `;` that isn't trailing).
  const withoutTrailing = cleaned.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    return { ok: false, reason: "only a single statement is allowed" };
  }

  // Must begin with SELECT or WITH (a CTE feeding a SELECT).
  if (!/^(select|with)\b/i.test(withoutTrailing)) {
    return { ok: false, reason: "only SELECT / WITH queries are allowed" };
  }

  // No mutating keyword anywhere (word-boundaried, case-insensitive).
  const upper = withoutTrailing.toUpperCase();
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`).test(upper)) {
      return { ok: false, reason: `statement contains a write keyword: ${kw}` };
    }
  }
  return { ok: true };
}
