/**
 * A KbNode is one indexed entry in the knowledge-base map: a single file
 * distilled to the fields the map and its navigation tools need. Files with
 * suite-style frontmatter (`name`, `description`, `metadata.type`, ...) get rich
 * nodes; plain files fall back to a hook derived from their first heading/line,
 * so the map works on a structured KB AND an arbitrary file tree.
 */
import { basename, extname } from "node:path";
import {
  parseFrontmatter,
  fmString,
  fmArray,
  type FmValue,
} from "./frontmatter";
import { extractLinks } from "./links";

export type KbTier = "index" | "warm";

export interface KbNode {
  /** POSIX path relative to the KB root (the stable id used by tools). */
  path: string;
  /** Frontmatter `name`, else the filename without extension. */
  name: string;
  /** Frontmatter `description`, else a hook derived from the body. */
  description: string;
  /** Frontmatter `type` / `metadata.type`, when present. */
  type?: string;
  /** `index` = shown in the always-on map; `warm` = grep-only via search_map. */
  tier: KbTier;
  /** Frontmatter `tags`. */
  tags: string[];
  /** `[[wikilink]]` names referenced in the body. */
  links: string[];
  /** Top-level folder segment ("." for files in the root). */
  dir: string;
  mtimeMs: number;
  size: number;
}

export interface NodeOptions {
  /** Top-level folders whose files default to the warm tier. */
  warmFolders?: string[];
}

const DEFAULT_WARM_FOLDERS = ["archive", "warm", ".archive"];
const MAX_HOOK_CHARS = 140;

/** Top-level folder of a POSIX relative path ("." for root-level files). */
export function topDir(relPath: string): string {
  const slash = relPath.indexOf("/");
  return slash === -1 ? "." : relPath.slice(0, slash);
}

/** First heading or first prose line of a body, collapsed and truncated. */
export function deriveHook(body: string): string {
  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "" || line === "---") continue;
    const cleaned = line
      .replace(/^#+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned === "") continue;
    return cleaned.length > MAX_HOOK_CHARS
      ? cleaned.slice(0, MAX_HOOK_CHARS - 1) + "…"
      : cleaned;
  }
  return "";
}

function resolveTier(
  data: Record<string, FmValue>,
  dir: string,
  warmFolders: string[],
): KbTier {
  const explicit = fmString(data, "tier");
  if (explicit === "warm") return "warm";
  if (explicit === "index") return "index";
  return warmFolders.includes(dir) ? "warm" : "index";
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

/** Build a KbNode from a file's relative path, contents, and stat. */
export function fileToNode(
  relPath: string,
  text: string,
  stat: FileStat,
  options: NodeOptions = {},
): KbNode {
  const warmFolders = options.warmFolders ?? DEFAULT_WARM_FOLDERS;
  const { data, body } = parseFrontmatter(text);
  const dir = topDir(relPath);

  const name = fmString(data, "name") ?? basename(relPath, extname(relPath));
  const description = fmString(data, "description") ?? deriveHook(body);
  const type = fmString(data, "type");

  const node: KbNode = {
    path: relPath,
    name,
    description,
    tier: resolveTier(data, dir, warmFolders),
    tags: fmArray(data, "tags"),
    links: extractLinks(body),
    dir,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
  if (type !== undefined) node.type = type;
  return node;
}
