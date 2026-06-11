/**
 * Robustly pull a JSON value out of an LLM's free-text response: handles
 * ```json code fences and leading/trailing prose by scanning for the first
 * balanced object/array (quote- and escape-aware).
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;

  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("No JSON object or array found in text.");

  const open = body.charAt(start);
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in text.");
}
