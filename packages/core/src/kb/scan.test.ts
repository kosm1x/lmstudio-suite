import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanKbDir, collectKbFiles, signatureOfFiles } from "./scan";

let root = "";

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "kb-scan-"));
  await fsp.mkdir(join(root, "lessons"), { recursive: true });
  await fsp.mkdir(join(root, "archive"), { recursive: true });
  await fsp.mkdir(join(root, ".hidden"), { recursive: true });
  await fsp.writeFile(
    join(root, "lessons", "a.md"),
    "---\nname: alpha\ndescription: first\n---\nlinks [[beta]]",
  );
  await fsp.writeFile(
    join(root, "lessons", "b.md"),
    "---\nname: beta\ndescription: second\n---\nbody",
  );
  await fsp.writeFile(join(root, "archive", "old.md"), "# legacy note");
  await fsp.writeFile(join(root, "notes.txt"), "plain text note");
  await fsp.writeFile(join(root, "ignore.bin"), "not indexed");
  await fsp.writeFile(join(root, ".hidden", "secret.md"), "hidden");
});

afterAll(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

describe("collectKbFiles", () => {
  it("collects text files and skips dotdirs + non-text", async () => {
    const files = await collectKbFiles(root);
    const rel = files.map((f) => f.replace(root, "").replace(/\\/g, "/"));
    expect(rel).toContain("/lessons/a.md");
    expect(rel).toContain("/notes.txt");
    expect(rel).not.toContain("/ignore.bin");
    expect(rel.some((f) => f.includes(".hidden"))).toBe(false);
  });
});

describe("scanKbDir", () => {
  it("builds a graph with POSIX paths, tiers, and resolved links", async () => {
    const { graph, fileCount } = await scanKbDir(root);
    expect(fileCount).toBe(4);
    expect(graph.getByName("alpha")?.path).toBe("lessons/a.md");
    expect(graph.get("archive/old.md")?.tier).toBe("warm");
    const alpha = graph.getByName("alpha");
    expect(alpha && graph.outgoing(alpha).resolved.map((n) => n.name)).toEqual([
      "beta",
    ]);
  });

  it("produces a stable signature that changes on edit", async () => {
    const files = await collectKbFiles(root);
    const sig1 = await signatureOfFiles(root, files);
    const sig2 = await signatureOfFiles(root, files);
    expect(sig1).toBe(sig2);
    await fsp.writeFile(
      join(root, "lessons", "b.md"),
      "changed content longer",
    );
    const sig3 = await signatureOfFiles(root, files);
    expect(sig3).not.toBe(sig1);
  });
});
