/**
 * Minimal RFC-4180-ish CSV parsing + lightweight querying, dependency-free.
 *
 * Handles quoted fields containing commas, quotes (`""` escape), and newlines.
 * Not a full dialect engine (no custom delimiters/encodings) — enough to let a
 * local model read tabular data it has on disk.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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
    const c = text[i] as string;
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
      if (text[i + 1] === "\n") i++; // CRLF
      endRow();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  // Flush the trailing field/row unless the input ended exactly on a newline.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
}

/** First row is the header; the rest are data rows. */
export function toTable(text: string): CsvTable {
  const all = parseCsv(text);
  const header = all[0] ?? [];
  return { header, rows: all.slice(1) };
}

export type AggregateOp = "count" | "sum" | "avg" | "min" | "max";

/** Aggregate a numeric column. `count` ignores the column's values. */
export function aggregate(
  table: CsvTable,
  op: AggregateOp,
  column?: string,
): number {
  if (op === "count") return table.rows.length;
  if (!column) throw new Error(`${op} requires a column`);
  const idx = table.header.indexOf(column);
  if (idx < 0) throw new Error(`no such column: ${column}`);
  const nums = table.rows
    .map((r) => Number(r[idx]))
    .filter((x) => Number.isFinite(x));
  if (nums.length === 0)
    throw new Error(`column ${column} has no numeric values`);
  switch (op) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      // reduce, not Math.min(...nums) — spreading 100k+ args overflows the stack
      return nums.reduce((a, b) => (b < a ? b : a));
    case "max":
      return nums.reduce((a, b) => (b > a ? b : a));
  }
}
