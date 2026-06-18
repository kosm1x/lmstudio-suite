#!/usr/bin/env -S npx tsx
/**
 * Tool-call eval runner — the suite's differentiator: it tells you whether a
 * given LM Studio model actually calls the RIGHT tool with valid args, not just
 * whether it can hold a conversation.
 *
 * Needs LM Studio running with a model loaded. For each task it gives the model
 * a representative toolset (web + filesystem + data), runs an .act() loop while
 * tracing every tool call, then scores via the pure `scoreTask`. Prints a
 * per-model scorecard.
 *
 *   npx tsx src/run.ts [model-id]
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@lmstudio/sdk";
import {
  createClient,
  createWebTools,
  createFsTools,
  createDataTools,
  createScheduleTools,
  withTrace,
  type SearchConfig,
  type SearchProviderName,
} from "@lmstudio-suite/core";
import { TASKS, FIXTURES } from "./tasks";
import {
  scoreTask,
  buildScorecard,
  formatScorecard,
  type EvalResult,
  type RecordedCall,
} from "./score";

async function main(): Promise<void> {
  const modelId = process.argv[2];
  const root = await mkdtemp(join(tmpdir(), "lmstudio-eval-"));
  for (const [name, content] of Object.entries(FIXTURES)) {
    await writeFile(join(root, name), content);
  }

  const search: SearchConfig = {
    provider:
      (process.env["SEARCH_PROVIDER"] as SearchProviderName | undefined) ??
      "duckduckgo",
    apiKey: process.env["SEARCH_API_KEY"],
    searxngUrl: process.env["SEARXNG_URL"],
  };

  const client = createClient();
  const model = modelId
    ? await client.llm.model(modelId)
    : await client.llm.model();

  const results: EvalResult[] = [];
  for (const task of TASKS) {
    const calls: RecordedCall[] = [];
    const baseTools: Tool[] = [
      ...createWebTools({ search }),
      ...createFsTools({ root }),
      ...createDataTools({ root }),
      ...createScheduleTools({ root }),
    ];
    const tools = withTrace(baseTools, (t) =>
      calls.push({ name: t.name, args: t.args }),
    );
    process.stderr.write(`• ${task.name} … `);
    try {
      await model.act(task.prompt, tools, { maxPredictionRounds: 4 });
    } catch (err) {
      process.stderr.write(
        `(act error: ${err instanceof Error ? err.message : String(err)}) `,
      );
    }
    const result = scoreTask(task, calls);
    results.push(result);
    process.stderr.write(result.pass ? "PASS\n" : "FAIL\n");
  }

  await rm(root, { recursive: true, force: true });
  const card = buildScorecard(modelId ?? "loaded model", results);
  process.stdout.write("\n" + formatScorecard(card) + "\n");
}

main().catch((err) => {
  process.stderr.write(
    `\nEval error: ${err instanceof Error ? err.message : String(err)}\n` +
      "Is LM Studio running with its local server enabled and a tool-capable model loaded?\n",
  );
  process.exit(1);
});
