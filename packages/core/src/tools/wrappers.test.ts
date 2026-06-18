import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@lmstudio/sdk";
import {
  withTrace,
  withApproval,
  isMutatingTool,
  type ToolCallTrace,
} from "./wrappers";

/** A minimal fake tool whose implementation echoes a fixed result. */
function fakeTool(name: string, result = "ok"): Tool {
  return {
    name,
    description: name,
    implementation: vi.fn(async () => result),
  } as unknown as Tool;
}

const ctx = {} as never;
const callImpl = (t: Tool, params: Record<string, unknown>) =>
  (
    t as unknown as {
      implementation: (p: unknown, c: unknown) => Promise<string>;
    }
  ).implementation(params, ctx);

describe("isMutatingTool", () => {
  it("flags writers/deleters/shell/http, not readers", () => {
    expect(isMutatingTool("write_file")).toBe(true);
    expect(isMutatingTool("delete_file")).toBe(true);
    expect(isMutatingTool("run_shell")).toBe(true);
    expect(isMutatingTool("http_request")).toBe(true);
    expect(isMutatingTool("schedule_task")).toBe(true);
    expect(isMutatingTool("cancel_schedule")).toBe(true);
    expect(isMutatingTool("read_file")).toBe(false);
    expect(isMutatingTool("search_files")).toBe(false);
    expect(isMutatingTool("list_schedules")).toBe(false);
    expect(isMutatingTool("now")).toBe(false);
  });
});

describe("withTrace", () => {
  it("reports each call to the sink and returns the result unchanged", async () => {
    const traces: ToolCallTrace[] = [];
    const [t] = withTrace([fakeTool("read_file", "hello")], (x) =>
      traces.push(x),
    );
    const r = await callImpl(t!, { path: "a.txt" });
    expect(r).toBe("hello");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      name: "read_file",
      args: { path: "a.txt" },
      result: "hello",
    });
    expect(typeof traces[0]!.ms).toBe("number");
  });
});

describe("withApproval", () => {
  it("runs a mutating tool only when approved, and leaves readers untouched", async () => {
    const approve = vi.fn(async () => false);
    const tools = withApproval(
      [fakeTool("write_file", "wrote"), fakeTool("read_file", "read")],
      { approve },
    );
    const write = tools.find((t) => t.name === "write_file")!;
    const read = tools.find((t) => t.name === "read_file")!;

    // Declined → not executed, returns a message.
    expect(await callImpl(write, { path: "x" })).toMatch(/did not approve/);
    expect(approve).toHaveBeenCalledTimes(1);

    // Reader is never gated (approve not consulted) and runs normally.
    expect(await callImpl(read, {})).toBe("read");
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("executes the mutating tool when approved", async () => {
    const tools = withApproval([fakeTool("delete_file", "gone")], {
      approve: async () => true,
    });
    expect(await callImpl(tools[0]!, { path: "x" })).toBe("gone");
  });
});
