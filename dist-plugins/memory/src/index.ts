// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-memory. Do not edit; regenerate instead.

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
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";

// packages/core/src/client.ts
import { LMStudioClient } from "@lmstudio/sdk";

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

// packages/core/src/tools/web-tools.ts
import { tool } from "@lmstudio/sdk";
import { z } from "zod";

// packages/core/src/tools/local-tools.ts
import { tool as tool2 } from "@lmstudio/sdk";
import { z as z2 } from "zod";

// packages/plugin-memory/src/index-builder.ts
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".markdown", ".txt", ".text"]);
var MAX_FILES = 200;
var MAX_TOTAL_CHARS = 4e6;
async function collectFiles(root) {
  const out = [];
  const walk = async (dir) => {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
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
      const st = await fsp.stat(file);
      parts.push(`${relative(root, file)}:${st.mtimeMs}:${st.size}`);
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
    return JSON.parse(await fsp.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}
async function writeCache(file, cache) {
  try {
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(cache), "utf-8");
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
      const text = await fsp.readFile(file, "utf-8");
      totalChars += text.length;
      const source = relative(knowledgeDir, file);
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
async function preprocess(ctl, userMessage) {
  const query = userMessage.getText().trim();
  if (!query) return userMessage;
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const knowledgeDir = global.get("knowledgeDir").trim();
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
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withPromptPreprocessor(preprocess);
}
export {
  main,
  preprocess
};
