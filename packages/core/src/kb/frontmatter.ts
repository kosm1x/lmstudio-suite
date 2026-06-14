/**
 * A small, dependency-free YAML-frontmatter reader.
 *
 * It is deliberately NOT a general YAML parser — it understands exactly the
 * shape the suite's knowledge-base files use: a leading `---` fence, top-level
 * `key: value` scalars, inline `[a, b]` arrays, and ONE level of nesting under a
 * `metadata:` block (mirroring the project's own memory files). Anything fancier
 * is ignored rather than throwing, so a malformed header never blocks indexing.
 *
 * Known, accepted limitations (edge inputs the suite's files don't use):
 *   - a bracketed scalar (`description: [WIP]`) is read as a one-element array;
 *   - array splitting is naive on commas, so `tags: ["a, b", c]` splits inside
 *     the quotes. Quote a value without internal commas, or use a scalar.
 */

export type FmValue = string | string[] | Record<string, string>;
export interface Frontmatter {
  /** Parsed top-level keys (and a nested `metadata` object when present). */
  data: Record<string, FmValue>;
  /** The document body with the frontmatter fence removed. */
  body: string;
}

const OPEN_FENCE = /^---[ \t]*\r?\n/;
const CLOSE_FENCE = /^---[ \t]*$/;

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Parse a scalar, or an inline `[a, b, c]` array, into an FmValue. */
function parseValue(raw: string): string | string[] {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((part) => stripQuotes(part.trim()))
      .filter((part) => part !== "");
  }
  return stripQuotes(raw);
}

/** Split `key: value` (value may be empty). Returns null for non-kv lines. */
function splitKv(line: string): [string, string] | null {
  const match = line.match(/^([^:\s][^:]*):[ \t]*(.*)$/);
  if (!match) return null;
  return [(match[1] ?? "").trim(), (match[2] ?? "").trim()];
}

export function parseFrontmatter(text: string): Frontmatter {
  if (!OPEN_FENCE.test(text)) return { data: {}, body: text };

  const lines = text.split(/\r?\n/);
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (CLOSE_FENCE.test(lines[i] ?? "")) {
      close = i;
      break;
    }
  }
  if (close === -1) return { data: {}, body: text };

  const data: Record<string, FmValue> = {};
  let nested: Record<string, string> | null = null;

  for (let i = 1; i < close; i++) {
    const rawLine = lines[i] ?? "";
    if (rawLine.trim() === "") continue;

    const isIndented = /^[ \t]+/.test(rawLine);
    if (isIndented) {
      if (nested) {
        const kv = splitKv(rawLine.trim());
        if (kv) nested[kv[0]] = stripQuotes(kv[1]);
      }
      continue;
    }

    const kv = splitKv(rawLine);
    if (!kv) {
      nested = null;
      continue;
    }
    const [key, value] = kv;
    if (value === "") {
      // A bare `key:` opens a nested block (we only model one level deep).
      nested = {};
      data[key] = nested;
    } else {
      nested = null;
      data[key] = parseValue(value);
    }
  }

  return { data, body: lines.slice(close + 1).join("\n") };
}

/** Read a top-level string field, falling back to `metadata.<key>`. */
export function fmString(
  data: Record<string, FmValue>,
  key: string,
): string | undefined {
  const top = data[key];
  if (typeof top === "string") return top;
  const meta = data["metadata"];
  if (meta && !Array.isArray(meta) && typeof meta === "object") {
    const inner = meta[key];
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

/** Read a field as a string array (inline array, or a single scalar). */
export function fmArray(data: Record<string, FmValue>, key: string): string[] {
  const value = data[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}
