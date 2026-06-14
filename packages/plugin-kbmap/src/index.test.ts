import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ChatMessage,
  PromptPreprocessorController,
  ToolsProviderController,
} from "@lmstudio/sdk";
import { preprocess, toolsProvider } from "./index";

let root = "";

beforeAll(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "kbmap-plugin-"));
  await fsp.mkdir(join(root, "lessons"), { recursive: true });
  await fsp.writeFile(
    join(root, "lessons", "alpha.md"),
    "---\nname: alpha\ndescription: the alpha note\n---\nbody",
  );
});

afterAll(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

type Cfg = Record<string, unknown>;
const cfg = (v: Cfg) => ({ get: (k: string) => v[k] });

function controller(
  global: Cfg,
  chat: Cfg,
): ToolsProviderController & PromptPreprocessorController {
  return {
    getGlobalPluginConfig: () => cfg(global),
    getPluginConfig: () => cfg(chat),
    abortSignal: new AbortController().signal,
  } as unknown as ToolsProviderController & PromptPreprocessorController;
}

const message = (text: string) =>
  ({ getText: () => text }) as unknown as ChatMessage;

// A function, not a const: `root` is only assigned in beforeAll, so a top-level
// object literal would capture the empty initial value.
const GLOBAL = (): Cfg => ({
  knowledgeDir: root,
  warmFolders: ["archive"],
  incomingFolder: "incoming",
});
const CHAT = { injectMap: true, mapMaxChars: 4000, enableWrite: false };

describe("kb-map preprocess", () => {
  it("injects the map before the query when configured", async () => {
    const out = await preprocess(
      controller(GLOBAL(), CHAT),
      message("what do I know about alpha?"),
    );
    expect(typeof out).toBe("string");
    expect(out).toContain("## KB MAP");
    expect(out).toContain("- [alpha] lessons/alpha.md");
    expect(out).toContain("what do I know about alpha?");
  });

  it("passes the message through when the query is blank", async () => {
    const msg = message("   ");
    expect(await preprocess(controller(GLOBAL(), CHAT), msg)).toBe(msg);
  });

  it("passes through when no knowledge directory is set", async () => {
    const msg = message("hi");
    const out = await preprocess(
      controller({ knowledgeDir: "", warmFolders: [] }, CHAT),
      msg,
    );
    expect(out).toBe(msg);
  });

  it("passes through when injectMap is off", async () => {
    const msg = message("hi");
    const out = await preprocess(
      controller(GLOBAL(), { ...CHAT, injectMap: false }),
      msg,
    );
    expect(out).toBe(msg);
  });
});

describe("kb-map toolsProvider", () => {
  it("is inert (no tools) until a knowledge directory is configured", async () => {
    const tools = await toolsProvider(
      controller({ knowledgeDir: "", warmFolders: [] }, CHAT),
    );
    expect(tools).toEqual([]);
  });

  it("exposes read-only map tools by default", async () => {
    const tools = await toolsProvider(controller(GLOBAL(), CHAT));
    expect(tools.map((t) => t.name).sort()).toEqual([
      "follow_links",
      "map_overview",
      "read_node",
      "search_map",
    ]);
  });

  it("adds write_node + organize_incoming when enableWrite is on", async () => {
    const tools = await toolsProvider(
      controller(GLOBAL(), { ...CHAT, enableWrite: true }),
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain("write_node");
    expect(names).toContain("organize_incoming");
  });
});
