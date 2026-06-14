/**
 * Walk a knowledge-base directory and build a KbGraph.
 *
 * Three pieces, kept separate so a caching layer (e.g. the plugin) can compute a
 * cheap change-signature without re-reading every file:
 *   - collectKbFiles: enumerate indexable text files (sorted, bounded)
 *   - signatureOfFiles: a hash over path/mtime/size (cache invalidation key)
 *   - buildGraphFromFiles: read + parse the files into a KbGraph
 * scanKbDir composes all three for callers that just want the graph.
 */
import { promises as fsp, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, relative, sep } from "node:path";
import { KbGraph } from "./graph";
import { fileToNode, type KbNode, type NodeOptions } from "./node";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);
const DEFAULT_MAX_FILES = 2_000;

export interface ScanOptions extends NodeOptions {
  /** Cap on indexed files (default 2000). */
  maxFiles?: number;
}

/** POSIX-style relative path (stable across platforms for ids + the cache). */
function toPosix(root: string, full: string): string {
  const rel = relative(root, full);
  return sep === "/" ? rel : rel.split(sep).join("/");
}

/** Enumerate indexable text files under `root`, sorted, skipping dotdirs. */
export async function collectKbFiles(
  root: string,
  maxFiles = DEFAULT_MAX_FILES,
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= maxFiles) return;
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
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

/** A content-change signature over the file set (path + mtime + size). */
export async function signatureOfFiles(
  root: string,
  files: string[],
): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const st = await fsp.stat(file);
      parts.push(`${toPosix(root, file)}:${st.mtimeMs}:${st.size}`);
    } catch {
      /* skip unreadable files */
    }
  }
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

/** Read + parse a known file set into a KbGraph. */
export async function buildGraphFromFiles(
  root: string,
  files: string[],
  options: ScanOptions = {},
): Promise<KbGraph> {
  const nodes: KbNode[] = [];
  for (const file of files) {
    try {
      const [text, st] = await Promise.all([
        fsp.readFile(file, "utf-8"),
        fsp.stat(file),
      ]);
      nodes.push(
        fileToNode(
          toPosix(root, file),
          text,
          { mtimeMs: st.mtimeMs, size: st.size },
          options,
        ),
      );
    } catch {
      /* skip unreadable files */
    }
  }
  return new KbGraph(nodes);
}

export interface KbScan {
  graph: KbGraph;
  signature: string;
  fileCount: number;
}

/** Walk `root` and build a KbGraph (plus a change signature). */
export async function scanKbDir(
  root: string,
  options: ScanOptions = {},
): Promise<KbScan> {
  const files = await collectKbFiles(root, options.maxFiles);
  const [signature, graph] = await Promise.all([
    signatureOfFiles(root, files),
    buildGraphFromFiles(root, files, options),
  ]);
  return { graph, signature, fileCount: files.length };
}
