import { describe, expect, it } from "vitest";
import { createWebTools } from "./web-tools";
import { createFsTools, createShellTool } from "./local-tools";

const names = (tools: Array<{ name: string }>) =>
  tools.map((t) => t.name).sort();

describe("shared tool builders", () => {
  it("createWebTools builds web_search + fetch_url", () => {
    const tools = createWebTools({ search: {} }) as Array<{ name: string }>;
    expect(names(tools)).toEqual(["fetch_url", "web_search"]);
  });

  it("createFsTools builds read/write/list", () => {
    const tools = createFsTools({ root: "/tmp" }) as Array<{ name: string }>;
    expect(names(tools)).toEqual(["list_dir", "read_file", "write_file"]);
  });

  it("createShellTool builds run_shell", () => {
    expect((createShellTool({ cwd: "/tmp" }) as { name: string }).name).toBe(
      "run_shell",
    );
  });
});
