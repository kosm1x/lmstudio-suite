// Bundled by lmstudio-suite (scripts/package-plugins.mjs) from packages/plugin-kbmap. Do not edit; regenerate instead.

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
function fmString(data, key) {
  const top = data[key];
  if (typeof top === "string") return top;
  const meta = data["metadata"];
  if (meta && !Array.isArray(meta) && typeof meta === "object") {
    const inner = meta[key];
    if (typeof inner === "string") return inner;
  }
  return void 0;
}
function fmArray(data, key) {
  const value = data[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

// packages/core/src/kb/links.ts
var LINK_RE = /\[\[([^\]\n]+)\]\]/g;
function extractLinks(text) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(LINK_RE)) {
    const raw = (match[1] ?? "").split("|")[0] ?? "";
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// packages/core/src/kb/node.ts
import { basename, extname } from "node:path";
var DEFAULT_WARM_FOLDERS = ["archive", "warm", ".archive"];
var MAX_HOOK_CHARS = 140;
function topDir(relPath) {
  const slash = relPath.indexOf("/");
  return slash === -1 ? "." : relPath.slice(0, slash);
}
function deriveHook(body) {
  let inFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "" || line === "---") continue;
    const cleaned = line.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
    if (cleaned === "") continue;
    return cleaned.length > MAX_HOOK_CHARS ? cleaned.slice(0, MAX_HOOK_CHARS - 1) + "\u2026" : cleaned;
  }
  return "";
}
function resolveTier(data, dir, warmFolders) {
  const explicit = fmString(data, "tier");
  if (explicit === "warm") return "warm";
  if (explicit === "index") return "index";
  return warmFolders.includes(dir) ? "warm" : "index";
}
function fileToNode(relPath, text, stat, options = {}) {
  const warmFolders = options.warmFolders ?? DEFAULT_WARM_FOLDERS;
  const { data, body } = parseFrontmatter(text);
  const dir = topDir(relPath);
  const name = fmString(data, "name") ?? basename(relPath, extname(relPath));
  const description = fmString(data, "description") ?? deriveHook(body);
  const type = fmString(data, "type");
  const node = {
    path: relPath,
    name,
    description,
    tier: resolveTier(data, dir, warmFolders),
    tags: fmArray(data, "tags"),
    links: extractLinks(body),
    dir,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
  if (type !== void 0) node.type = type;
  return node;
}

// packages/core/src/kb/graph.ts
var KbGraph = class {
  nodes;
  byPath;
  byName;
  constructor(nodes) {
    this.nodes = nodes;
    this.byPath = /* @__PURE__ */ new Map();
    this.byName = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      this.byPath.set(node.path, node);
      if (!this.byName.has(node.name)) this.byName.set(node.name, node);
    }
  }
  get size() {
    return this.nodes.length;
  }
  get(path) {
    return this.byPath.get(path);
  }
  getByName(name) {
    return this.byName.get(name);
  }
  /** Forward links of a node, split into resolved nodes and dangling names. */
  outgoing(node) {
    const resolved = [];
    const dangling = [];
    for (const name of node.links) {
      const target = this.byName.get(name);
      if (target) resolved.push(target);
      else dangling.push(name);
    }
    return { resolved, dangling };
  }
  /** Nodes whose body links to `node` (by its name). */
  incoming(node) {
    const out = [];
    for (const candidate of this.nodes) {
      if (candidate.path === node.path) continue;
      if (candidate.links.includes(node.name)) out.push(candidate);
    }
    return out;
  }
};

// packages/core/src/kb/scan.ts
import { promises as fsp2 } from "node:fs";
import { createHash } from "node:crypto";
import { extname as extname2, join, relative as relative2, sep as sep2 } from "node:path";
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".markdown", ".txt", ".text"]);
var DEFAULT_MAX_FILES = 2e3;
function toPosix(root, full) {
  const rel = relative2(root, full);
  return sep2 === "/" ? rel : rel.split(sep2).join("/");
}
async function collectKbFiles(root, maxFiles = DEFAULT_MAX_FILES) {
  const out = [];
  const walk = async (dir) => {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await fsp2.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(extname2(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out.sort();
}
async function signatureOfFiles(root, files) {
  const parts = [];
  for (const file of files) {
    try {
      const st = await fsp2.stat(file);
      parts.push(`${toPosix(root, file)}:${st.mtimeMs}:${st.size}`);
    } catch {
    }
  }
  return createHash("sha1").update(parts.join("|")).digest("hex");
}
async function buildGraphFromFiles(root, files, options = {}) {
  const nodes = [];
  for (const file of files) {
    try {
      const [text, st] = await Promise.all([
        fsp2.readFile(file, "utf-8"),
        fsp2.stat(file)
      ]);
      nodes.push(
        fileToNode(
          toPosix(root, file),
          text,
          { mtimeMs: st.mtimeMs, size: st.size },
          options
        )
      );
    } catch {
    }
  }
  return new KbGraph(nodes);
}

// packages/core/src/kb/digest.ts
var DEFAULT_MAX_CHARS = 4e3;
var MAX_DESC_CHARS = 110;
function clampDesc(desc) {
  const oneLine = desc.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DESC_CHARS ? oneLine.slice(0, MAX_DESC_CHARS - 1) + "\u2026" : oneLine;
}
function renderNodeLine(node, maxLinks) {
  let line = `- [${node.name}] ${node.path}`;
  const desc = clampDesc(node.description);
  if (desc) line += ` \u2014 ${desc}`;
  if (node.links.length > 0) {
    const shown = node.links.slice(0, maxLinks).join(", ");
    const extra = node.links.length > maxLinks ? ", \u2026" : "";
    line += `  \u2192 ${shown}${extra}`;
  }
  return line;
}
function dirLabel(dir) {
  return dir === "." ? "(root)" : dir + "/";
}
function groupByDir(nodes) {
  const groups = /* @__PURE__ */ new Map();
  const sorted = [...nodes].sort(
    (a, b) => a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir)
  );
  for (const node of sorted) {
    const list = groups.get(node.dir);
    if (list) list.push(node);
    else groups.set(node.dir, [node]);
  }
  return [...groups];
}
function renderDigest(graph, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLinks = options.maxLinksPerNode ?? 3;
  const index = graph.nodes.filter((n) => n.tier === "index");
  const warm = graph.nodes.filter((n) => n.tier === "warm");
  const header = `## KB MAP${options.root ? ` (root: ${options.root})` : ""} \xB7 ${graph.size} entries` + (warm.length ? ` \xB7 ${warm.length} warm` : "");
  const RESERVE = 100;
  const softMax = maxChars > RESERVE ? maxChars - RESERVE : maxChars;
  const out = [];
  let used = 0;
  const push = (line) => {
    out.push(line);
    used += line.length + 1;
  };
  const fits = (line) => used + line.length + 1 <= softMax;
  const fitsSummary = (line) => used + line.length + 1 <= maxChars;
  push(header);
  push("");
  const groups = groupByDir(index);
  let truncated = false;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (!group) continue;
    const [dir, nodes] = group;
    const heading = `### ${dirLabel(dir)}`;
    const firstLine = nodes[0] ? renderNodeLine(nodes[0], maxLinks) : "";
    if (used + heading.length + 1 + firstLine.length + 1 > softMax) {
      const remEntries = groups.slice(gi).reduce((sum, [, ns]) => sum + ns.length, 0);
      const remFolders = groups.length - gi;
      const summary = `\u2026 +${remEntries} more entries across ${remFolders} folders \u2014 use search_map / map_overview`;
      if (fitsSummary(summary)) push(summary);
      truncated = true;
      break;
    }
    push(heading);
    let shown = 0;
    for (const node of nodes) {
      const line = renderNodeLine(node, maxLinks);
      if (!fits(line)) {
        const rollup = `  (+${nodes.length - shown} more in ${dir} \u2014 use search_map)`;
        if (fits(rollup)) push(rollup);
        break;
      }
      push(line);
      shown++;
    }
  }
  if (!truncated && warm.length > 0) {
    const warmGroups = groupByDir(warm);
    let openedSection = false;
    for (let wi = 0; wi < warmGroups.length; wi++) {
      const group = warmGroups[wi];
      if (!group) continue;
      const [dir, nodes] = group;
      const line = `### ${dirLabel(dir)}  (warm \xB7 ${nodes.length} entries \u2014 not expanded; use search_map)`;
      const blankCost = openedSection ? 0 : 2;
      if (used + blankCost + line.length + 1 > softMax) {
        const remFolders = warmGroups.length - wi;
        const summary = `\u2026 +${remFolders} more warm folders \u2014 use search_map`;
        if (fitsSummary(summary)) push(summary);
        break;
      }
      if (!openedSection) {
        push("");
        openedSection = true;
      }
      push(line);
    }
  }
  return out.join("\n");
}
function renderFolder(graph, folder, maxLinks = 3) {
  const wanted = folder === "(root)" ? "." : folder.replace(/\/$/, "");
  const nodes = graph.nodes.filter((n) => n.dir === wanted).sort((a, b) => a.name.localeCompare(b.name));
  if (nodes.length === 0) {
    return `No entries in folder "${folder}". Use map_overview to see folders.`;
  }
  const heading = `### ${wanted === "." ? "(root)" : wanted + "/"} \xB7 ${nodes.length} entries`;
  return [heading, ...nodes.map((n) => renderNodeLine(n, maxLinks))].join("\n");
}

// packages/core/src/kb/search.ts
var WEIGHT_NAME = 3;
var WEIGHT_TAG = 2;
var WEIGHT_PATH = 2;
var WEIGHT_DESC = 1;
function scoreToken(node, token) {
  let score = 0;
  if (node.name.toLowerCase().includes(token)) score += WEIGHT_NAME;
  if (node.tags.some((t) => t.toLowerCase().includes(token)))
    score += WEIGHT_TAG;
  if (node.path.toLowerCase().includes(token)) score += WEIGHT_PATH;
  if (node.description.toLowerCase().includes(token)) score += WEIGHT_DESC;
  return score;
}
function searchNodes(graph, query, limit = 12) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const hits = [];
  for (const node of graph.nodes) {
    let total = 0;
    let missedToken = false;
    for (const token of tokens) {
      const s = scoreToken(node, token);
      if (s === 0) {
        missedToken = true;
        break;
      }
      total += s;
    }
    if (!missedToken && total > 0) hits.push({ node, score: total });
  }
  hits.sort(
    (a, b) => b.score === a.score ? a.node.path.localeCompare(b.node.path) : b.score - a.score
  );
  return hits.slice(0, limit);
}

// packages/core/src/kb/organize.ts
var DEFAULT_TYPE_FOLDERS = {
  project: "projects",
  area: "areas",
  reference: "references",
  note: "notes",
  daily: "daily"
};
function basename2(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
function destFolderFor(node, typeFolders, knownFolders) {
  const type = node.type?.toLowerCase();
  if (type && typeFolders[type]) {
    return { folder: typeFolders[type], reason: `type=${type}` };
  }
  for (const tag of node.tags) {
    const t = tag.toLowerCase();
    if (typeFolders[t]) return { folder: typeFolders[t], reason: `tag=${tag}` };
    if (knownFolders.has(t)) return { folder: t, reason: `tag=${tag}` };
  }
  return null;
}
function planIncomingMoves(graph, options = {}) {
  const incoming = options.incomingFolder ?? "incoming";
  const typeFolders = options.typeFolders ?? DEFAULT_TYPE_FOLDERS;
  const knownFolders = new Set(Object.values(typeFolders));
  const moves = [];
  const conflicts = [];
  const unsorted = [];
  for (const node of graph.nodes) {
    if (node.dir !== incoming) continue;
    const dest = destFolderFor(node, typeFolders, knownFolders);
    const folder = dest?.folder ?? options.defaultFolder;
    if (!folder || folder === incoming) {
      unsorted.push({ path: node.path, reason: "no type/tag match" });
      continue;
    }
    const to = `${folder}/${basename2(node.path)}`;
    if (graph.get(to)) {
      conflicts.push({ from: node.path, to, reason: "target already exists" });
      continue;
    }
    moves.push({ from: node.path, to, reason: dest?.reason ?? "default" });
  }
  return { moves, conflicts, unsorted };
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
import { extname as extname3 } from "node:path";
import { tool as tool4 } from "@lmstudio/sdk";
import { z as z4 } from "zod";
var msg = (err) => err instanceof Error ? err.message : String(err);
var WRITABLE_EXTENSIONS = /* @__PURE__ */ new Set([".md", ".markdown", ".txt", ".text"]);
function createMapTools(options) {
  const { root, loadGraph } = options;
  const fs = new ScopedFs(root);
  const digestMaxChars = options.digestMaxChars ?? 4e3;
  const incomingFolder = options.incomingFolder ?? "incoming";
  const tools = [
    tool4({
      name: "map_overview",
      description: "Show the knowledge-base map: a compact index of entries (name, path, one-line description, links), grouped by folder. Call with no argument for the whole map, or pass a folder name to list just that folder in full. Start here to see what exists before reading anything.",
      parameters: {
        folder: z4.string().optional().describe("Optional folder name to expand in full (e.g. 'lessons').")
      },
      implementation: async ({ folder }, { status }) => {
        status(folder ? `Map of ${folder}/` : "Map overview");
        const graph = await loadGraph();
        if (graph.size === 0) return "(the knowledge base is empty)";
        return folder ? renderFolder(graph, folder) : renderDigest(graph, { root, maxChars: digestMaxChars });
      }
    }),
    tool4({
      name: "search_map",
      description: "Search the map by keyword across entry names, paths, descriptions and tags. Unlike the always-on map this also searches archived/warm entries. Returns matching entries with their paths (read one with read_node). Use multiple words to narrow \u2014 every word must match.",
      parameters: {
        query: z4.string().describe("Keywords to search for."),
        limit: z4.number().int().min(1).max(50).default(12).describe("Max results (default 12).")
      },
      implementation: async ({ query, limit }, { status }) => {
        status(`Searching: ${query}`);
        const graph = await loadGraph();
        const hits = searchNodes(graph, query, limit);
        if (hits.length === 0) return `No entries match "${query}".`;
        return hits.map((h) => renderNodeLine(h.node, 3)).join("\n");
      }
    }),
    tool4({
      name: "read_node",
      description: "Read the full contents of one entry by its path (the path shown in the map). Use after map_overview/search_map to pull the detail behind a one-line description.",
      parameters: {
        path: z4.string().describe("Entry path relative to the KB root.")
      },
      implementation: async ({ path }, { status, warn }) => {
        status(`Reading ${path}`);
        const graph = await loadGraph();
        if (!graph.get(path)) {
          return `Error: "${path}" is not an indexed entry. Use map_overview or search_map to find entries.`;
        }
        try {
          return await fs.readFile(path);
        } catch (err) {
          const m = msg(err);
          warn(`read_node failed: ${m}`);
          return `Error: ${m}`;
        }
      }
    }),
    tool4({
      name: "follow_links",
      description: "Given an entry's path, list the entries it links to (via [[name]]) and the entries that link back to it. Use to traverse related notes \u2014 the associative graph the flat map does not show. Dangling links (no entry yet) are reported separately.",
      parameters: {
        path: z4.string().describe("Entry path to traverse from.")
      },
      implementation: async ({ path }, { status }) => {
        status(`Links of ${path}`);
        const graph = await loadGraph();
        const node = graph.get(path);
        if (!node)
          return `Error: no entry at "${path}". Use map_overview or search_map.`;
        const out = graph.outgoing(node);
        const incoming = graph.incoming(node);
        const sections = [];
        sections.push(
          out.resolved.length ? "Links to:\n" + out.resolved.map((n) => renderNodeLine(n, 0)).join("\n") : "Links to: (none)"
        );
        if (out.dangling.length)
          sections.push(
            `Dangling links (no entry yet): ${out.dangling.join(", ")}`
          );
        sections.push(
          incoming.length ? "Linked from:\n" + incoming.map((n) => renderNodeLine(n, 0)).join("\n") : "Linked from: (none)"
        );
        return sections.join("\n\n");
      }
    })
  ];
  if (options.enableWrite) {
    tools.push(
      tool4({
        name: "write_node",
        description: `Save a note into the knowledge base. For a NEW capture, write it to \`${incomingFolder}/<kebab-name>.md\` (the inbox; organize_incoming sorts it later). ALWAYS begin the file with YAML frontmatter and fill every field:
---
name: <kebab-slug matching the filename>
description: <one concise sentence summarising the note>
metadata:
  type: <project | area | note | reference>
tags: [<2-5 lowercase topic tags>]
---
Then a \`# Title\` and the body. Good name/description/type/tags are what let the note be sorted and found later, so do not leave them blank. The map refreshes automatically on the next turn.`,
        parameters: {
          path: z4.string().describe(
            `Destination path relative to the KB root, ending in .md (e.g. '${incomingFolder}/my-note.md').`
          ),
          content: z4.string().describe(
            "Full file contents, starting with the YAML frontmatter block."
          )
        },
        implementation: async ({ path, content }, { status, warn }) => {
          status(`Writing ${path}`);
          if (!WRITABLE_EXTENSIONS.has(extname3(path).toLowerCase())) {
            return `Error: write_node only writes text notes (${[...WRITABLE_EXTENSIONS].join(", ")}); refusing "${path}".`;
          }
          try {
            await fs.writeFile(path, content);
            return `Wrote ${content.length} characters to ${path}.`;
          } catch (err) {
            const m = msg(err);
            warn(`write_node failed: ${m}`);
            return `Error: ${m}`;
          }
        }
      }),
      tool4({
        name: "organize_incoming",
        description: `Sort the \`${incomingFolder}/\` inbox into the knowledge base's folders using each note's frontmatter type and tags (type: project \u2192 projects/, a 'reference' tag \u2192 references/, etc.). Call with apply=false (default) to PREVIEW the moves, then apply=true to perform them. Notes with no usable type/tag are left in the inbox.`,
        parameters: {
          apply: z4.boolean().default(false).describe("false = preview the plan; true = perform the moves.")
        },
        implementation: async ({ apply }, { status, warn }) => {
          status(
            apply ? `Organizing ${incomingFolder}/` : `Previewing ${incomingFolder}/ sort`
          );
          const graph = await loadGraph();
          const plan = planIncomingMoves(graph, { incomingFolder });
          const movable = [];
          for (const m of plan.moves) {
            if (await fs.exists(m.to)) {
              plan.conflicts.push({
                from: m.from,
                to: m.to,
                reason: "target already exists"
              });
            } else {
              movable.push(m);
            }
          }
          if (movable.length === 0 && plan.conflicts.length === 0) {
            return plan.unsorted.length > 0 ? `Nothing to sort: ${plan.unsorted.length} note(s) in ${incomingFolder}/ have no type/tag to route on.` : `${incomingFolder}/ is empty \u2014 nothing to organize.`;
          }
          const lines = [];
          if (!apply) {
            lines.push(
              `Planned moves (re-run organize_incoming with apply=true to perform):`
            );
            for (const m of movable)
              lines.push(`  ${m.from} \u2192 ${m.to}   (${m.reason})`);
          } else {
            let moved = 0;
            for (const m of movable) {
              try {
                await fs.move(m.from, m.to);
                moved++;
              } catch (err) {
                const e = msg(err);
                warn(`move failed: ${e}`);
                plan.conflicts.push({ from: m.from, to: m.to, reason: e });
              }
            }
            lines.push(`Moved ${moved} note(s).`);
          }
          if (plan.conflicts.length > 0) {
            lines.push(`Skipped (conflicts):`);
            for (const c of plan.conflicts)
              lines.push(`  ${c.from} \u2192 ${c.to}   (${c.reason})`);
          }
          if (plan.unsorted.length > 0) {
            lines.push(
              `Left in ${incomingFolder}/ (no type/tag): ${plan.unsorted.map((u) => u.path).join(", ")}`
            );
          }
          return lines.join("\n");
        }
      })
    );
  }
  return tools;
}

// packages/core/src/tools/data-tools.ts
import { tool as tool5 } from "@lmstudio/sdk";
import { z as z5 } from "zod";

// packages/core/src/tools/memory-tools.ts
import { tool as tool6 } from "@lmstudio/sdk";
import { z as z6 } from "zod";

// packages/plugin-kbmap/src/index.ts
import { homedir } from "node:os";
import { resolve as resolve2 } from "node:path";

// packages/plugin-kbmap/src/config.ts
import { createConfigSchematics } from "@lmstudio/sdk";
var globalConfigSchematics = createConfigSchematics().field(
  "knowledgeDir",
  "string",
  {
    displayName: "Knowledge directory",
    hint: "Absolute path to the folder of notes/memories to map (.md/.txt). Supports a leading ~. Leave blank to disable.",
    placeholder: "~/notes"
  },
  ""
).field(
  "warmFolders",
  "stringArray",
  {
    displayName: "Warm (archived) folders",
    hint: "Top-level folders kept out of the always-on map and reached only via search_map. Good for large archives."
  },
  ["archive"]
).field(
  "incomingFolder",
  "string",
  {
    displayName: "Inbox folder",
    hint: "Folder new captures (write_node) land in, and that organize_incoming sorts by type/tags. Relative to the knowledge directory.",
    placeholder: "incoming"
  },
  "incoming"
).build();
var chatConfigSchematics = createConfigSchematics().field(
  "injectMap",
  "boolean",
  {
    displayName: "Inject the map each turn",
    hint: "Prepend the knowledge-base map to your message so the model always knows what exists. Turn off to rely only on the map_overview tool."
  },
  true
).field(
  "mapMaxChars",
  "numeric",
  {
    displayName: "Max map characters",
    hint: "Budget for the injected/overview map. Large knowledge bases roll overflow into per-folder summaries reachable via search_map.",
    int: true,
    min: 500,
    max: 2e4
  },
  4e3
).field(
  "enableWrite",
  "boolean",
  {
    displayName: "Enable write_node",
    hint: "Let the model create or update entries in the knowledge base. Off by default.",
    warning: "write_node writes files inside your knowledge directory with your user account's privileges. Only enable for trusted models/tasks."
  },
  false
).build();

// packages/plugin-kbmap/src/map-cache.ts
import { promises as fsp3 } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
var SCHEMA_VERSION = "1";
function cachePath(dir, warmFolders) {
  const hash = createHash2("sha1").update(`${dir}|${warmFolders.join(",")}|v${SCHEMA_VERSION}`).digest("hex").slice(0, 16);
  return join2(tmpdir(), "lmstudio-kbmap", `${hash}.json`);
}
async function readCache(file) {
  try {
    return JSON.parse(await fsp3.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}
async function writeCache(file, cache) {
  try {
    await fsp3.mkdir(dirname2(file), { recursive: true });
    await fsp3.writeFile(file, JSON.stringify(cache), "utf-8");
  } catch {
  }
}
async function getOrBuildKbGraph(knowledgeDir, warmFolders) {
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

// packages/plugin-kbmap/src/index.ts
function expandHome(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve2(homedir(), p.slice(2));
  return p ? resolve2(p) : "";
}
async function preprocess(ctl, userMessage) {
  const query = userMessage.getText().trim();
  if (!query) return userMessage;
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir").trim());
  if (!dir || !chat.get("injectMap")) return userMessage;
  try {
    const graph = await getOrBuildKbGraph(dir, global.get("warmFolders"));
    if (graph.size === 0) return userMessage;
    const digest = renderDigest(graph, {
      root: dir,
      maxChars: chat.get("mapMaxChars")
    });
    return `${digest}

${query}`;
  } catch {
    return userMessage;
  }
}
async function toolsProvider(ctl) {
  const global = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const chat = ctl.getPluginConfig(chatConfigSchematics);
  const dir = expandHome(global.get("knowledgeDir").trim());
  if (!dir) return [];
  const warmFolders = global.get("warmFolders");
  const rawIncoming = global.get("incomingFolder").trim();
  const incomingFolder = rawIncoming && !rawIncoming.includes("/") && !rawIncoming.includes("..") ? rawIncoming : "incoming";
  return createMapTools({
    root: dir,
    enableWrite: chat.get("enableWrite"),
    digestMaxChars: chat.get("mapMaxChars"),
    incomingFolder,
    loadGraph: () => getOrBuildKbGraph(dir, warmFolders)
  });
}
async function main(context) {
  context.withConfigSchematics(chatConfigSchematics).withGlobalConfigSchematics(globalConfigSchematics).withPromptPreprocessor(preprocess).withToolsProvider(toolsProvider);
}
export {
  main,
  preprocess,
  toolsProvider
};
