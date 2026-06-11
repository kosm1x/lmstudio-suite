/**
 * Build (and cache) a VectorStore from a directory of text files.
 *
 * The cache lives in the OS temp dir, keyed by (knowledgeDir + embedding model),
 * and is invalidated by a signature over each file's path/mtime/size — so edits
 * trigger a re-index but unchanged dirs load instantly without re-embedding.
 */
import { promises as fsp, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import {
  indexDocuments,
  VectorStore,
  type EmbedFn,
  type SerializedStore,
  type SourceDocument,
} from "@lmstudio-suite/core";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);
const MAX_FILES = 200;
const MAX_TOTAL_CHARS = 4_000_000;

interface CacheFile {
  signature: string;
  store: SerializedStore;
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    let entries: Dirent[];
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
      else if (
        entry.isFile() &&
        TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out.sort();
}

async function signatureOf(files: string[], root: string): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      parts.push(`${relative(root, file)}:${st.mtimeMs}:${st.size}`);
    } catch {
      /* skip unreadable files */
    }
  }
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

function cachePath(knowledgeDir: string, model: string): string {
  const hash = createHash("sha1")
    .update(`${knowledgeDir}|${model}`)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), "lmstudio-memory", `${hash}.json`);
}

async function readCache(file: string): Promise<CacheFile | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf-8")) as CacheFile;
  } catch {
    return null;
  }
}

async function writeCache(file: string, cache: CacheFile): Promise<void> {
  try {
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(cache), "utf-8");
  } catch {
    /* cache is best-effort; ignore write failures */
  }
}

/** Load the cached store if the directory is unchanged, otherwise re-index. */
export async function getOrBuildStore(
  knowledgeDir: string,
  model: string,
  embed: EmbedFn,
): Promise<VectorStore> {
  const files = await collectFiles(knowledgeDir);
  const signature = await signatureOf(files, knowledgeDir);
  const cacheFile = cachePath(knowledgeDir, model);

  const cached = await readCache(cacheFile);
  if (cached && cached.signature === signature) {
    return VectorStore.fromJSON(cached.store);
  }

  const docs: SourceDocument[] = [];
  let totalChars = 0;
  for (const file of files) {
    if (totalChars > MAX_TOTAL_CHARS) break;
    try {
      const text = await fsp.readFile(file, "utf-8");
      totalChars += text.length;
      const source = relative(knowledgeDir, file);
      docs.push({ id: source, text, metadata: { source } });
    } catch {
      /* skip unreadable files */
    }
  }

  const entries = await indexDocuments(docs, embed, {
    chunkSize: 1_000,
    overlap: 150,
  });
  const store = new VectorStore();
  store.addAll(entries);
  await writeCache(cacheFile, { signature, store: store.toJSON() });
  return store;
}
