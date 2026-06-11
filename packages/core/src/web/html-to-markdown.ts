/**
 * Dependency-light HTML -> Markdown converter tuned for feeding web pages to an
 * LLM context window. Not a perfect Markdown emitter: it strips boilerplate
 * (scripts, nav, footers), keeps headings/links/lists/code, and collapses
 * whitespace so the result is compact and readable.
 */
import {
  parse,
  NodeType,
  type HTMLElement,
  type Node,
  type TextNode,
} from "node-html-parser";

const STRIP = new Set([
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "svg",
  "iframe",
  "button",
  "input",
  "select",
  "textarea",
  "template",
  "label",
]);

const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "blockquote",
  "pre",
  "table",
]);

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      safeCodePoint(parseInt(h, 16)),
    )
    .replace(/&[a-zA-Z]+;/g, (m) => NAMED_ENTITIES[m] ?? m);
}

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function isElement(n: Node): n is HTMLElement {
  return n.nodeType === NodeType.ELEMENT_NODE;
}
function isText(n: Node): n is TextNode {
  return n.nodeType === NodeType.TEXT_NODE;
}

function renderChildren(el: HTMLElement): string {
  return el.childNodes.map(render).join("");
}

function render(node: Node): string {
  if (isText(node)) return decodeEntities(node.rawText).replace(/\s+/g, " ");
  if (!isElement(node)) return "";

  const tag = node.rawTagName?.toLowerCase() ?? "";
  if (STRIP.has(tag)) return "";

  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag.slice(1));
      return `\n\n${"#".repeat(level)} ${renderChildren(node).trim()}\n\n`;
    }
    case "strong":
    case "b": {
      const inner = renderChildren(node).trim();
      return inner ? `**${inner}**` : "";
    }
    case "em":
    case "i": {
      const inner = renderChildren(node).trim();
      return inner ? `*${inner}*` : "";
    }
    case "code": {
      const inner = decodeEntities(node.text).trim();
      return inner ? `\`${inner}\`` : "";
    }
    case "pre": {
      const inner = decodeEntities(node.text).replace(/\n+$/, "");
      return `\n\n\`\`\`\n${inner}\n\`\`\`\n\n`;
    }
    case "a": {
      const inner = renderChildren(node).trim();
      if (!inner) return "";
      const href = node.getAttribute("href") ?? "";
      if (!href || href.startsWith("javascript:") || href.startsWith("#"))
        return inner;
      return `[${inner}](${href})`;
    }
    case "ul":
    case "ol": {
      const ordered = tag === "ol";
      let idx = 1;
      const lines: string[] = [];
      for (const child of node.childNodes) {
        if (isElement(child) && child.rawTagName?.toLowerCase() === "li") {
          const marker = ordered ? `${idx++}.` : "-";
          const inner = renderChildren(child)
            .trim()
            .replace(/\s*\n\s*/g, " ");
          if (inner) lines.push(`${marker} ${inner}`);
        }
      }
      return lines.length ? `\n\n${lines.join("\n")}\n\n` : "";
    }
    case "blockquote": {
      const inner = renderChildren(node).trim();
      if (!inner) return "";
      const quoted = inner
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }
    case "tr": {
      const cells: string[] = [];
      for (const child of node.childNodes) {
        const t = isElement(child) ? child.rawTagName?.toLowerCase() : "";
        if (t === "td" || t === "th") {
          cells.push(
            renderChildren(child as HTMLElement)
              .trim()
              .replace(/\s*\n\s*/g, " "),
          );
        }
      }
      return cells.length ? `\n| ${cells.join(" | ")} |` : "";
    }
    default: {
      const inner = renderChildren(node);
      return BLOCK.has(tag) ? `\n\n${inner}\n\n` : inner;
    }
  }
}

/** Convert an HTML document (or fragment) to compact Markdown text. */
export function htmlToMarkdown(html: string): string {
  const root = parse(html, { comment: false });
  for (const sel of STRIP) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }
  const main =
    root.querySelector("article") ??
    root.querySelector("main") ??
    root.querySelector("body") ??
    root;
  return renderChildren(main)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Extract a best-effort page title from a parsed HTML document. */
export function extractTitle(html: string): string {
  const root = parse(html, { comment: false });
  const og = root
    .querySelectorAll("meta")
    .find((m) => m.getAttribute("property") === "og:title")
    ?.getAttribute("content");
  const title =
    og?.trim() ||
    root.querySelector("title")?.text.trim() ||
    root.querySelector("h1")?.text.trim() ||
    "";
  return decodeEntities(title);
}
