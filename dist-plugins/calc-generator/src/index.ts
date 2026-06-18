// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-generator. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

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

// packages/core/src/tools/memory-tools.ts
import { tool as tool6 } from "@lmstudio/sdk";
import { z as z6 } from "zod";

// packages/core/src/tools/time-tools.ts
import { tool as tool7 } from "@lmstudio/sdk";
import { z as z7 } from "zod";

// packages/plugin-generator/src/generator.ts
function respondTo(message) {
  const expr = message.trim();
  if (!expr) return "Send me an arithmetic expression, e.g. (3 + 4) * 2.";
  try {
    return `${expr} = ${evalArithmetic(expr)}`;
  } catch {
    return `I only evaluate arithmetic (+ - * / % ^ and parentheses). "${expr}" isn't one \u2014 try e.g. 2 ^ 10.`;
  }
}
function lastUserText(history) {
  const messages = history.getMessagesArray();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.getRole() === "user") return m.getText();
  }
  return "";
}

// packages/plugin-generator/src/index.ts
async function generate(ctl, history) {
  const reply = respondTo(lastUserText(history));
  for (const fragment of reply.split(/(\s+)/)) {
    if (fragment) ctl.fragmentGenerated(fragment);
  }
}
async function main(context) {
  context.withGenerator(generate);
}
export {
  generate,
  main
};
