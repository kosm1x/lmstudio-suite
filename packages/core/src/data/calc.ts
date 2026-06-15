/**
 * Safe arithmetic expression evaluator — no `eval`, no `Function`.
 *
 * Grammar (precedence low→high):
 *   expr  := term  (('+' | '-') term)*
 *   term  := power (('*' | '/' | '%') power)*
 *   power := unary ('^' power)?            // right-associative
 *   unary := ('+' | '-') unary | primary
 *   primary := number | '(' expr ')'
 *
 * Numbers may be decimal or scientific (`1.5`, `.5`, `2e3`). Any unexpected
 * character or malformed input throws — the caller turns that into an error
 * string for the model.
 */
interface Token {
  type: "number" | "op";
  value: string;
  num?: number;
}

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
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

export function evalArithmetic(expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => tokens[pos++] as Token;

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = next().value;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (peek() && ["*", "/", "%"].includes(peek()!.value)) {
      const op = next().value;
      const rhs = parseUnary();
      if (op === "*") v *= rhs;
      else if (op === "/") v /= rhs;
      else v %= rhs;
    }
    return v;
  }
  // Unary binds looser than `^`, so `-2^2` is `-(2^2)` = -4 (Python/standard).
  function parseUnary(): number {
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
  // Right-associative; the exponent is a unary so `2^-1` and `2^3^2` work.
  function parsePower(): number {
    const base = parsePrimary();
    if (peek()?.value === "^") {
      next();
      return Math.pow(base, parseUnary());
    }
    return base;
  }
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.type === "number") {
      next();
      return t.num as number;
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
    throw new Error(`unexpected token '${peek()!.value}'`);
  }
  if (!Number.isFinite(result))
    throw new Error("result is not a finite number");
  return result;
}
