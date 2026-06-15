/**
 * Filesystem access scoped to a single root directory.
 *
 * Every path supplied by a model is resolved against `root` and rejected if it
 * escapes (via `..`, an absolute path, etc). This is the safe-by-default
 * substrate for the local-tools plugin's file operations.
 *
 * Caveat: this guards against path-string traversal, not against symlinks that
 * already exist inside the root and point outside it. Point a ScopedFs only at
 * directories you trust.
 */
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ScopedFsOptions {
  /** Max bytes returned by readFile before truncating (default 1_000_000). */
  maxReadBytes?: number;
}

export type DirEntryType = "file" | "dir" | "other";
export interface DirEntry {
  name: string;
  type: DirEntryType;
}

export interface StatInfo {
  type: DirEntryType;
  /** Size in bytes. */
  size: number;
  /** Last-modified time, ms since epoch. */
  mtimeMs: number;
}

/** Directory names skipped by `walk` unless overridden. */
export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
]);

export class PathEscapeError extends Error {
  constructor(p: string) {
    super(`Path escapes the allowed root directory: ${p}`);
    this.name = "PathEscapeError";
  }
}

export class ScopedFs {
  /** Absolute, resolved root directory. */
  readonly root: string;
  private readonly maxReadBytes: number;

  constructor(root: string, options: ScopedFsOptions = {}) {
    this.root = resolve(root);
    this.maxReadBytes = options.maxReadBytes ?? 1_000_000;
  }

  /** Resolve a relative path within the root, throwing if it would escape. */
  resolvePath(relPath: string): string {
    const target = resolve(this.root, relPath);
    const rel = relative(this.root, target);
    if (rel === "") return target; // the root itself
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new PathEscapeError(relPath);
    }
    return target;
  }

  async readFile(relPath: string): Promise<string> {
    const p = this.resolvePath(relPath);
    const stat = await fsp.stat(p);
    if (stat.size <= this.maxReadBytes) return fsp.readFile(p, "utf-8");
    const fh = await fsp.open(p, "r");
    try {
      const buf = Buffer.alloc(this.maxReadBytes);
      const { bytesRead } = await fh.read(buf, 0, this.maxReadBytes, 0);
      return buf.subarray(0, bytesRead).toString("utf-8") + "\n…[truncated]";
    } finally {
      await fh.close();
    }
  }

  /**
   * Read the entire file with no truncation cap. Use for edit/transform
   * operations, where writing back a model-facing (size-capped) read would
   * silently drop everything past the cap. `readFile` is the capped read.
   */
  async readFileFull(relPath: string): Promise<string> {
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
  async writeFile(relPath: string, content: string): Promise<void> {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** Atomically write raw bytes (e.g. a downloaded file). Same temp+rename. */
  async writeBytes(relPath: string, data: Uint8Array): Promise<void> {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomUUID()}`;
    try {
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, p);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** Move/rename a file within the root; both ends are traversal-guarded. */
  async move(fromRel: string, toRel: string): Promise<void> {
    const from = this.resolvePath(fromRel);
    const to = this.resolvePath(toRel);
    await fsp.mkdir(dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }

  async list(relPath = "."): Promise<DirEntry[]> {
    const p = this.resolvePath(relPath);
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries
      .map(
        (e): DirEntry => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fsp.stat(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }

  /** Type + size + mtime for a path. Throws (ENOENT) if it does not exist. */
  async stat(relPath: string): Promise<StatInfo> {
    const s = await fsp.stat(this.resolvePath(relPath));
    return {
      type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
      size: s.size,
      mtimeMs: s.mtimeMs,
    };
  }

  /**
   * Recursively yield file paths (relative to root, POSIX-separated `/`) under
   * `relPath`. Yields files only; directories whose name is in `ignore` are
   * pruned. Symlinks are not followed, and unreadable directories are skipped
   * rather than throwing. Iteration order is unspecified — sort if you need it.
   */
  async *walk(
    relPath = ".",
    options: { ignore?: ReadonlySet<string> } = {},
  ): AsyncGenerator<string> {
    const ignore = options.ignore ?? DEFAULT_IGNORE_DIRS;
    const stack: string[] = [this.resolvePath(relPath)];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable directory → skip
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

  async mkdir(relPath: string): Promise<void> {
    await fsp.mkdir(this.resolvePath(relPath), { recursive: true });
  }

  /** Remove a file or directory. Refuses to remove the root itself. */
  async remove(relPath: string): Promise<void> {
    const p = this.resolvePath(relPath);
    if (p === this.root)
      throw new Error("Refusing to remove the root directory.");
    await fsp.rm(p, { recursive: true, force: true });
  }
}
