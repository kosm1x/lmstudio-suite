/**
 * Tiny JSON path navigator — a jq-lite for reading a value out of parsed JSON.
 *
 * Supported path syntax (a leading `.` or `$` is optional):
 *   .a.b          object keys
 *   a[0]          array index
 *   a["weird.key"] bracketed string key (for keys with dots/spaces)
 *   .             the root itself
 *
 * No filters, slices, wildcards, or recursion — just a deterministic walk.
 * Returns `undefined` if any segment is missing.
 */
export function parseJsonPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  let i = 0;
  const s = path.trim();
  // Skip a leading root marker.
  if (s[i] === "$") i++;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) throw new Error("unclosed '[' in path");
      let inner = s.slice(i + 1, close).trim();
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        segments.push(inner.slice(1, -1));
      } else if (/^-?\d+$/.test(inner)) {
        segments.push(Number(inner));
      } else if (inner.length > 0) {
        segments.push(inner);
      }
      i = close + 1;
      continue;
    }
    // Bare key: read until the next '.' or '['.
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    const key = s.slice(i, j);
    if (key.length > 0) segments.push(key);
    i = j;
  }
  return segments;
}

export function queryJsonPath(root: unknown, path: string): unknown {
  const segments = parseJsonPath(path);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg < 0 ? cur.length + seg : seg];
    } else {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}
