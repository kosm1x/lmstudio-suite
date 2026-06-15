import { describe, it, expect } from "vitest";
import {
  scoreTask,
  buildScorecard,
  formatScorecard,
  type EvalTask,
  type RecordedCall,
} from "./score";

const task: EvalTask = {
  name: "arithmetic",
  prompt: "compute",
  expectedTool: "calculator",
  validateArgs: (a) => typeof a.expression === "string",
};

describe("scoreTask", () => {
  it("passes when the expected tool is called with valid args", () => {
    const calls: RecordedCall[] = [
      { name: "calculator", args: { expression: "1+1" } },
    ];
    const r = scoreTask(task, calls);
    expect(r).toMatchObject({ called: true, validArgs: true, pass: true });
  });

  it("misses when the expected tool is never called (BAD tool instead)", () => {
    const r = scoreTask(task, [{ name: "read_file", args: { path: "x" } }]);
    expect(r).toMatchObject({ called: false, validArgs: false, pass: false });
    expect(r.toolsCalled).toEqual(["read_file"]);
  });

  it("fails on bad args even if the tool was called", () => {
    const r = scoreTask(task, [{ name: "calculator", args: { wrong: 1 } }]);
    expect(r).toMatchObject({ called: true, validArgs: false, pass: false });
  });

  it("does not penalise extra READ-ONLY calls before the right one", () => {
    const r = scoreTask(task, [
      { name: "read_file", args: {} },
      { name: "calculator", args: { expression: "2*2" } },
    ]);
    expect(r.pass).toBe(true);
  });

  it("fails a read-only task when the model calls a mutating tool (anti-spray)", () => {
    const r = scoreTask(task, [
      { name: "calculator", args: { expression: "2*2" } },
      { name: "write_file", args: { path: "x", content: "y" } },
    ]);
    expect(r.mutatingCalls).toEqual(["write_file"]);
    expect(r.pass).toBe(false);
  });

  it("treats a throwing validator as invalid args, not a crash", () => {
    const throwy: EvalTask = {
      ...task,
      validateArgs: () => {
        throw new Error("boom");
      },
    };
    expect(scoreTask(throwy, [{ name: "calculator", args: {} }]).pass).toBe(
      false,
    );
  });
});

describe("scorecard", () => {
  it("counts passes and renders a summary line", () => {
    const results = [
      scoreTask(task, [{ name: "calculator", args: { expression: "1" } }]),
      scoreTask(task, [{ name: "read_file", args: {} }]),
    ];
    const card = buildScorecard("test-model", results);
    expect(card).toMatchObject({ passed: 1, total: 2 });
    const text = formatScorecard(card);
    expect(text).toMatch(/test-model/);
    expect(text).toMatch(/1\/2 passed \(50%\)/);
    expect(text).toMatch(/MISSED/);
  });
});
