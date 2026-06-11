/**
 * Robustly pull a JSON value out of an LLM's free-text response.
 *
 * Strategy: search regions in order of trust — ```json fences, then any ```
 * fence, then the whole text. Within a region, scan every top-level `{`/`[`
 * candidate, keep only those that actually `JSON.parse`, and prefer the longest
 * (the real payload, not an incidental "[1]" in prose). Quote/escape aware.
 */
export function extractJson(text: string): unknown {
  const regions: string[] = [];
  for (const m of text.matchAll(/```json\s*([\s\S]*?)```/gi))
    regions.push(m[1] ?? "");
  for (const m of text.matchAll(/```\s*([\s\S]*?)```/gi))
    regions.push(m[1] ?? "");
  regions.push(text);

  for (const region of regions) {
    const found = bestJsonIn(region);
    if (found !== undefined) return found;
  }
  throw new Error("No JSON object or array found in text.");
}

/** Largest successfully-parsed top-level JSON value in `s`, or undefined. */
function bestJsonIn(s: string): unknown {
  let best: { value: unknown; length: number } | undefined;
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch !== "{" && ch !== "[") {
      i++;
      continue;
    }
    const span = balancedSpan(s, i);
    if (!span) {
      i++;
      continue;
    }
    try {
      const value = JSON.parse(span.text) as unknown;
      if (!best || span.text.length > best.length)
        best = { value, length: span.text.length };
    } catch {
      /* not valid JSON; ignore this candidate */
    }
    i = span.end + 1; // skip past this top-level candidate (don't re-scan its insides)
  }
  return best?.value;
}

/** The balanced `{...}`/`[...]` span starting at `start`, quote/escape aware. */
function balancedSpan(
  s: string,
  start: number,
): { text: string; end: number } | undefined {
  const open = s.charAt(start);
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = start; j < s.length; j++) {
    const c = s.charAt(j);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { text: s.slice(start, j + 1), end: j };
    }
  }
  return undefined;
}
