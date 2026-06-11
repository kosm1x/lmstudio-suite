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

  /** Write a file, creating parent directories as needed. */
  async writeFile(relPath: string, content: string): Promise<void> {
    const p = this.resolvePath(relPath);
    await fsp.mkdir(dirname(p), { recursive: true });
    await fsp.writeFile(p, content, "utf-8");
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
