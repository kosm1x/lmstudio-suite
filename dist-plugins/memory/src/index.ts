// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-memory. Do not edit; regenerate instead.

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

// packages/core/src/fs/scoped-fs.ts
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
var DEFAULT_IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules"
]);
var PathEscapeError = class extends Error {
  constructor(p) {
    super(`Path escapes the allowed root directory: ${p}`);
    this.name = "PathEscapeError";
  }
};
var ScopedFs = class {
  /** Absolute, resolved root directory. */
  root;
  maxReadBytes;
  constructor(root, options = {}) {
    this.root = resolve(root);
    this.maxReadBytes = options.maxReadBytes ?? 1e6;
  }
  /** Resolve a relative path within the root, throwing if it would escape. */
  resolvePath(relPath) {
    const target = resolve(this.root, relPath);
    const rel = relative(this.root, target);
    if (rel === "") return target;
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }
  async readFile(relPath) {
    const p = this.resolvePath(relPath);
    const stat = await fsp.stat(p);
    if (stat.size <= this.maxReadBytes) return fsp.readFile(p, "utf-8");
    const fh = await fsp.open(p, "r");
    try {
      const buf = Buffer.alloc(this.maxReadBytes);
      const { bytesRead } = await fh.read(buf, 0, this.maxReadBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf-8") + "\n\u2026[truncated]";
    } finally {
      await fh.close();
    }
  }
  /**
   * Read the entire file with no truncation cap. Use for edit/transform
   * operations, where writing back a model-facing (size-capped) read would
   * silently drop everything past the cap. `readFile` is the capped read.
   */
  async readFileFull(relPath) {
    return fsp.readFile(this.resolvePath(relPath), "utf-8");
  }
  /**
   * Write a file, creating parent directories as needed.
   *
   * Atomic: the content is staged to a sibling temp file and renamed into
   * place, so a crash mid-write leaves the temp file rather than a truncated
   * original. (rename is atomic within a filesystem; the temp sits in the same
   * directory as the target, hence the same filesystem.) This matters for
   * `edit_file`, where a partial write would corrupt existing content.
   */
  async writeFile(relPath, content) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /** Atomically write raw bytes (e.g. a downloaded file). Same temp+rename. */
  async writeBytes(relPath, data) {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {
      });
      throw err;
    }
  }
  /** Move/rename a file within the root; both ends are traversal-guarded. */
  async move(fromRel, toRel) {
    const from = this.resolvePath(fromRel);
    const to = this.resolvePath(toRel);
    await fsp.mkdir(dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }
  async list(relPath = ".") {
    const p = this.resolvePath(relPath);
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map(
      (e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other"
      })
    ).sort((a, b) => a.name.localeCompare(b.name));
  }
  async exists(relPath) {
    try {
      await fsp.stat(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }
  /** Type + size + mtime for a path. Throws (ENOENT) if it does not exist. */
  async stat(relPath) {
    const s = await fsp.stat(this.resolvePath(relPath));
    return {
      type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
      size: s.size,
      mtimeMs: s.mtimeMs
    };
  }
  /**
   * Recursively yield file paths (relative to root, POSIX-separated `/`) under
   * `relPath`. Yields files only; directories whose name is in `ignore` are
   * pruned. Symlinks are not followed, and unreadable directories are skipped
   * rather than throwing. Iteration order is unspecified — sort if you need it.
   */
  async *walk(relPath = ".", options = {}) {
    const ignore = options.ignore ?? DEFAULT_IGNORE_DIRS;
    const stack = [this.resolvePath(relPath)];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (!ignore.has(e.name)) stack.push(abs);
        } else if (e.isFile()) {
          yield relative(this.root, abs).split(sep).join("/");
        }
      }
    }
  }
  async mkdir(relPath) {
    await fsp.mkdir(this.resolvePath(relPath), { recursive: true });
  }
  /** Remove a file or directory. Refuses to remove the root itself. */
  async remove(relPath) {
    const p = this.resolvePath(relPath);
    if (p === this.root)
      throw new Error("Refusing to remove the root directory.");
    await fsp.rm(p, { recursive: true, force: true });
  }
};

// packages/core/src/rag/chunk.ts
function chunkText(text, options = {}) {
  const chunkSize = Math.max(1, options.chunkSize ?? 1e3);
  const overlap = Math.min(
    Math.max(0, options.overlap ?? 150),
    Math.floor(chunkSize / 2)
  );
  const clean = text.replace(/\r\n/g, "\n").replace(/ /g, " ").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  const flush = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };
  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      flush();
      const stride = Math.max(1, chunkSize - overlap);
      for (let i = 0; i < para.length; i += stride) {
        chunks.push(para.slice(i, i + chunkSize));
      }
      continue;
    }
    const candidate = current ? `${current}

${para}` : para;
    if (candidate.length > chunkSize) {
      flush();
      current = para;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

// packages/core/src/rag/vector-store.ts
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  const score = dot / denom;
  return Number.isFinite(score) ? score : 0;
}
var VectorStore = class _VectorStore {
  entries = [];
  get size() {
    return this.entries.length;
  }
  add(entry) {
    this.entries.push(entry);
  }
  addAll(entries) {
    for (const e of entries) this.entries.push(e);
  }
  clear() {
    this.entries = [];
  }
  /**
   * Return the top-K entries by cosine similarity, filtered by `minScore`.
   * Entries whose vector dimension differs from the query (e.g. left over from a
   * different embedding model) are skipped rather than throwing.
   */
  query(vector, topK = 5, minScore = -Infinity) {
    const scored = [];
    for (const entry of this.entries) {
      if (entry.vector.length !== vector.length) continue;
      scored.push({ entry, score: cosineSimilarity(vector, entry.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= minScore).slice(0, Math.max(0, topK));
  }
  toJSON() {
    return { version: 1, entries: this.entries };
  }
  static fromJSON(data) {
    const store = new _VectorStore();
    if (data?.entries) store.addAll(data.entries);
    return store;
  }
};

// packages/core/src/rag/indexer.ts
async function indexDocuments(docs, embed, chunkOptions = {}) {
  const pending = [];
  for (const doc of docs) {
    chunkText(doc.text, chunkOptions).forEach((text, i) => {
      pending.push({ id: `${doc.id}#${i}`, text, metadata: doc.metadata });
    });
  }
  if (pending.length === 0) return [];
  const vectors = await embed(pending.map((p) => p.text));
  if (vectors.length !== pending.length) {
    throw new Error(
      `Embed function returned ${vectors.length} vectors for ${pending.length} chunks.`
    );
  }
  return pending.map((p, i) => ({
    id: p.id,
    vector: vectors[i] ?? [],
    text: p.text,
    metadata: p.metadata
  }));
}

// packages/core/src/kb/frontmatter.ts
var OPEN_FENCE = /^---[ \t]*\r?\n/;
var CLOSE_FENCE = /^---[ \t]*$/;
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}
function parseValue(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((part) => stripQuotes(part.trim())).filter((part) => part !== "");
  }
  return stripQuotes(raw);
}
function splitKv(line) {
  const match = line.match(/^([^:\s][^:]*):[ \t]*(.*)$/);
  if (!match) return null;
  return [(match[1] ?? "").trim(), (match[2] ?? "").trim()];
}
function parseFrontmatter(text) {
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
  const data = {};
  let nested = null;
  for (let i = 1; i < close; i++) {
    const rawLine = lines[i] ?? "";
    if (rawLine.trim() === "") continue;
    const isIndented = /^[ \t]+/.test(rawLine);
    if (isIndented) {
      if (nested) {
        const kv2 = splitKv(rawLine.trim());
        if (kv2) nested[kv2[0]] = stripQuotes(kv2[1]);
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
      nested = {};
      data[key] = nested;
    } else {
      nested = null;
      data[key] = parseValue(value);
    }
  }
  return { data, body: lines.slice(close + 1).join("\n") };
}
function fmArray(data, key) {
  const value = data[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
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
var msg = (err) => err instanceof Error ? err.message : String(err);
var RECALL_MAX = 10;
function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-").slice(0, 60);
  return slug || "note";
}
function todayIso() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function buildNote(text, tags) {
  const lines = ["---"];
  if (tags.length > 0) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`created: ${todayIso()}`, "---", "", text.trim(), "");
  return lines.join("\n");
}
function createMemoryTools(options) {
  const fs = new ScopedFs(options.root);
  const subdir = (options.subdir ?? "memories").replace(/\/+$/, "");
  const rel = (id) => `${subdir}/${id}.md`;
  async function chooseId(text, given) {
    const base = given ? slugify(given) : slugify(text);
    if (given) return base;
    let id = base;
    let n = 2;
    while (await fs.exists(rel(id))) id = `${base}-${n++}`;
    return id;
  }
  return [
    tool6({
      name: "remember",
      description: "Save a fact to long-term memory so it can be retrieved in later sessions. Use when the user shares something worth keeping (a preference, decision, name, path). Stored as a markdown note in the knowledge directory, so the memory plugin's retrieval picks it up automatically. Pass an existing id to update that note.",
      parameters: {
        text: z6.string().describe("The fact to remember. Keep it concise but complete."),
        tags: z6.array(z6.string()).optional().describe(
          "Optional tags for grouping (e.g. ['preference', 'setup'])."
        ),
        id: z6.string().optional().describe(
          "Existing note id to overwrite. Omit to create a new note."
        )
      },
      implementation: async ({ text, tags = [], id }, { status, warn }) => {
        status("remember");
        if (!text.trim()) return "Error: nothing to remember (empty text).";
        try {
          const noteId = await chooseId(text, id);
          await fs.writeFile(rel(noteId), buildNote(text, tags));
          return `Remembered as "${noteId}".`;
        } catch (err) {
          warn(`remember failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool6({
      name: "recall",
      description: "Search saved memories by keyword and return the best matches with their ids. Use to check what you already know before answering, or to find the id of a note to update or forget. Returns an empty result \u2014 not an error \u2014 when nothing matches.",
      parameters: {
        query: z6.string().describe("Keywords to search saved memories for."),
        limit: z6.number().optional().describe(`Max matches to return (default ${RECALL_MAX}).`)
      },
      implementation: async ({ query, limit }, { status, warn }) => {
        status("recall");
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return "Error: empty query.";
        const cap = Math.min(limit ?? RECALL_MAX, 50);
        try {
          const scored = [];
          for await (const path of fs.walk(subdir)) {
            if (!path.endsWith(".md")) continue;
            const id = path.slice(subdir.length + 1, -3);
            const raw = await fs.readFileFull(path).catch(() => "");
            if (!raw) continue;
            const { data, body } = parseFrontmatter(raw);
            const tags = fmArray(data, "tags");
            const hay = `${id} ${tags.join(" ")} ${body}`.toLowerCase();
            const score = tokens.filter((t) => hay.includes(t)).length;
            if (score === 0) continue;
            const first = body.trim().split("\n")[0] ?? "";
            scored.push({
              id,
              score,
              line: `[${id}] ${first.slice(0, 160)}${tags.length ? ` (${tags.join(", ")})` : ""}`
            });
          }
          if (scored.length === 0) return `No memories match "${query}".`;
          scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          return scored.slice(0, cap).map((s) => s.line).join("\n");
        } catch (err) {
          warn(`recall failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    }),
    tool6({
      name: "forget",
      description: "Delete a saved memory by its id (use recall to find the id first). Use when a fact is wrong or the user asks you to forget it. Irreversible.",
      parameters: {
        id: z6.string().describe("The id of the memory note to delete.")
      },
      implementation: async ({ id }, { status, warn }) => {
        status("forget");
        const safeId = slugify(id);
        try {
          if (!await fs.exists(rel(safeId)))
            return `No memory with id "${id}". Use recall to list ids.`;
          await fs.remove(rel(safeId));
          return `Forgot "${safeId}".`;
        } catch (err) {
          warn(`forget failed: ${msg(err)}`);
          return `Error: ${msg(err)}`;
        }
      }
    })
  ];
}

// packages/plugin-memory/src/index.ts
import { homedir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// packages/plugin-memory/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var globalConfigSchematics = createConfigSchematics().field(
  "embeddingModel",
  "string",
  {
    displayName: "Embedding model",
    hint: "Identifier of an LM Studio embedding model to use for retrieval.",
    placeholder: "text-embedding-nomic-embed-text-v1.5"
  },
  ""
).field(
  "knowledgeDir",
  "string",
  {
    displayName: "Knowledge directory",
    hint: "Absolute path to a folder of .md/.txt files to retrieve context from. Leave blank to disable.",
    placeholder: "/home/me/notes"
  },
  ""
).build();
var chatConfigSchematics = createConfigSchematics().field(
  "topK",
  "numeric",
  {
    displayName: "Snippets to retrieve",
    int: true,
    min: 1,
    max: 12,
    slider: { min: 1, max: 12, step: 1 }
  },
  4
).field(
  "minScore",
  "numeric",
  {
    displayName: "Minimum similarity (0\u20131)",
    hint: "Only inject snippets at least this similar to the query.",
    min: 0,
    max: 1,
    step: 0.05,
    slider: { min: 0, max: 1, step: 0.05 }
  },
  0.35
).field(
  "maxChars",
  "numeric",
  {
    displayName: "Max injected context characters",
    int: true,
    min: 200,
    max: 2e4
  },
  2e3
).field(
  "enableWrite",
  "boolean",
  {
    displayName: "Enable memory write tools",
    hint: "Expose remember / recall / forget so the model can save facts to the knowledge directory (retrieved automatically on later messages). Off by default."
  },
  false
).build();

// packages/plugin-memory/src/context.ts
function buildContextBlock(hits, maxChars) {
  const blocks = [];
  let used = 0;
  for (const hit of hits) {
    const source = hit.entry.metadata?.["source"] ?? hit.entry.id;
    const snippet = `[${source}] (similarity ${hit.score.toFixed(2)})
${hit.entry.text}`;
    if (used + snippet.length > maxChars && blocks.length > 0) break;
    blocks.push(snippet);
    used += snippet.length;
  }
  return [
    "Relevant context retrieved from the user's knowledge base. Use it if helpful; ignore it if not relevant:",
    ...blocks
  ].join("\n\n---\n\n");
}

// packages/plugin-memory/src/index-builder.ts
import { promises as fsp2 } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname as dirname2, extname, join, relative as relative2 } from "node:path";
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".markdown", ".txt", ".text"]);
var MAX_FILES = 200;
var MAX_TOTAL_CHARS = 4e6;
async function collectFiles(root) {
  const out = [];
  const walk = async (dir) => {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fsp2.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out.sort();
}
async function signatureOf(files, root) {
  const parts = [];
  for (const file of files) {
    try {
      const st = await fsp2.stat(file);
      parts.push(`${relative2(root, file)}:${st.mtimeMs}:${st.size}`);
    } catch {
    }
  }
  return createHash("sha1").update(parts.join("|")).digest("hex");
}
function cachePath(knowledgeDir, model) {
  const hash = createHash("sha1").update(`${knowledgeDir}|${model}`).digest("hex").slice(0, 16);
  return join(tmpdir(), "lmstudio-memory", `${hash}.json`);
}
async function readCache(file) {
  try {
    return JSON.parse(await fsp2.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}
async function writeCache(file, cache) {
  try {
    await fsp2.mkdir(dirname2(file), { recursive: true });
    await fsp2.writeFile(file, JSON.stringify(cache), "utf-8");
  } catch {
  }
}
async function getOrBuildStore(knowledgeDir, model, embed) {
  const files = await collectFiles(knowledgeDir);
  const signature = await signatureOf(files, knowledgeDir);
  const cacheFile = cachePath(knowledgeDir, model);
  const cached = await readCache(cacheFile);
  if (cached && cached.signature === signature) {
    return VectorStore.fromJSON(cached.store);
  }
  const docs = [];
  let totalChars = 0;
  for (const file of files) {
    if (totalChars > MAX_TOTAL_CHARS) break;
    try {
      const text = await fsp2.readFile(file, "utf-8");
      totalChars += text.length;
      const source = relative2(knowledgeDir, file);
      docs.push({ id: source, text, metadata: { source } });
    } catch {
    }
  }
  const entries = await indexDocuments(docs, embed, {
    chunkSize: 1e3,
    overlap: 150
  });
  const store = new VectorStore();
  store.addAll(entries);
  await writeCache(cacheFile, { signature, store: store.toJSON() });
  return store;
}

// packages/plugin-memory/src/index.ts
function expandHome(p) {
  const t = p.trim();
  if (!t) return "";
  const expanded = t === "~" || t.startsWith("~/") ? join2(homedir(), t.slice(1)) : t;
  return resolve2(expanded);
}
async function preprocess(ctl, userMessage) {
  const query = userMessage.getText().trim();
  if (!query) return userMessage;
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const knowledgeDir = expandHome(global.get("knowledgeDir"));
  const embeddingModel = global.get("embeddingModel").trim();
  if (!knowledgeDir || !embeddingModel) return userMessage;
  try {
    const handle = await ctl.client.embedding.model(embeddingModel);
    const embed = async (texts) => (await handle.embed(texts)).map((r) => r.embedding);
    const store = await getOrBuildStore(knowledgeDir, embeddingModel, embed);
    if (store.size === 0) return userMessage;
    const [queryVector] = await embed([query]);
    if (!queryVector) return userMessage;
    const hits = store.query(
      queryVector,
      chat.get("topK"),
      chat.get("minScore")
    );
    if (hits.length === 0) return userMessage;
    return `${buildContextBlock(hits, chat.get("maxChars"))}

${query}`;
  } catch {
    return userMessage;
  }
}
async function toolsProvider(ctl) {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir"));
  if (!dir || !chat.get("enableWrite")) return [];
  return createMemoryTools({ root: dir });
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withPromptPreprocessor(preprocess).withToolsProvider(toolsProvider);
}
export {
  main,
  preprocess,
  toolsProvider
};
