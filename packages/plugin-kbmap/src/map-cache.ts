/**
 * Build (and cache) a KbGraph from a knowledge-base directory.
 *
 * Mirrors the memory plugin's index-builder: the cache lives in the OS temp dir,
 * keyed by (directory + warm-folder config + schema version), and is invalidated
 * by a path/mtime/size signature. So an unchanged KB loads instantly and a
 * model's write_node (which bumps an mtime) transparently rebuilds the map next
 * turn. No embedding model is involved — the structural map is pure + cheap.
 */
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  KbGraph,
  buildGraphFromFiles,
  collectKbFiles,
  signatureOfFiles,
  type KbNode,
} from "@lmstudio-suite/core";

const SCHEMA_VERSION = "1";

interface CacheFile {
  signature: string;
  nodes: KbNode[];
}

function cachePath(dir: string, warmFolders: string[]): string {
  const hash = createHash("sha1")
    .update(`${dir}|${warmFolders.join(",")}|v${SCHEMA_VERSION}`)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), "lmstudio-kbmap", `${hash}.json`);
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

/** Load the cached graph if the directory is unchanged, otherwise rebuild it. */
export async function getOrBuildKbGraph(
  knowledgeDir: string,
  warmFolders: string[],
): Promise<KbGraph> {
  const files = await collectKbFiles(knowledgeDir);
  const signature = await signatureOfFiles(knowledgeDir, files);
  const cacheFile = cachePath(knowledgeDir, warmFolders);

  const cached = await readCache(cacheFile);
  if (cached && cached.signature === signature) {
    return new KbGraph(cached.nodes);
  }

  const graph = await buildGraphFromFiles(knowledgeDir, files, { warmFolders });
  await writeCache(cacheFile, { signature, nodes: graph.nodes });
  return graph;
}
