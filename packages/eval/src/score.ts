/**
 * Pure scoring for the tool-call eval — kept separate from the LM Studio runner
 * so it is fully unit-testable offline.
 *
 * A task passes when the model called the expected tool at least once AND the
 * args of one such call satisfy the task's validator. Calling extra tools is
 * not penalised (the model may legitimately read before acting); calling the
 * wrong tool *instead* fails, because the expected tool never appears.
 */
export interface EvalTask {
  /** Short identifier. */
  name: string;
  /** The user instruction handed to the model. */
  prompt: string;
  /** The tool a correct model should call. */
  expectedTool: string;
  /** Validate a call's arguments. Defaults to "any args accepted". */
  validateArgs?: (args: Record<string, unknown>) => boolean;
}

export interface RecordedCall {
  name: string;
  args: unknown;
}

export interface EvalResult {
  task: string;
  expectedTool: string;
  /** Was the expected tool called at all? */
  called: boolean;
  /** Did at least one call to it have valid args? */
  validArgs: boolean;
  /** called && validArgs. */
  pass: boolean;
  /** Names of every tool the model called, in order. */
  toolsCalled: string[];
}

export function scoreTask(task: EvalTask, calls: RecordedCall[]): EvalResult {
  const validate = task.validateArgs ?? (() => true);
  const matching = calls.filter((c) => c.name === task.expectedTool);
  const called = matching.length > 0;
  const validArgs =
    called &&
    matching.some((c) => {
      try {
        return validate((c.args ?? {}) as Record<string, unknown>);
      } catch {
        return false;
      }
    });
  return {
    task: task.name,
    expectedTool: task.expectedTool,
    called,
    validArgs,
    pass: called && validArgs,
    toolsCalled: calls.map((c) => c.name),
  };
}

export interface Scorecard {
  model: string;
  passed: number;
  total: number;
  results: EvalResult[];
}

export function buildScorecard(
  model: string,
  results: EvalResult[],
): Scorecard {
  return {
    model,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    results,
  };
}

/** Render a scorecard as a plain-text table + summary line. */
export function formatScorecard(card: Scorecard): string {
  const rows = card.results.map((r) => {
    const mark = r.pass ? "PASS" : r.called ? "BAD-ARGS" : "MISSED";
    return `  ${mark.padEnd(9)} ${r.task.padEnd(20)} expected ${r.expectedTool} | called: ${r.toolsCalled.join(", ") || "(none)"}`;
  });
  const pct =
    card.total === 0 ? 0 : Math.round((card.passed / card.total) * 100);
  return [
    `Tool-call scorecard — ${card.model}`,
    ...rows,
    `  ${"".padEnd(0)}${card.passed}/${card.total} passed (${pct}%)`,
  ].join("\n");
}
