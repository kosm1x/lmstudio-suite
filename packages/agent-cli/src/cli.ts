#!/usr/bin/env -S npx tsx
/**
 * lmstudio-agent — a standalone local agent.
 *
 * Connects to LM Studio, gives the model the full suite of tools (web search +
 * fetch, scoped filesystem, optional shell), and runs an agentic .act() loop.
 */
import type { ChatMessage, Tool } from "@lmstudio/sdk";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  createClient,
  createDataTools,
  createFsTools,
  createHttpTools,
  createMapTools,
  createMemoryTools,
  createScheduleTools,
  createShellTool,
  createTimeTools,
  createWebTools,
  hostTimezone,
  timeContextLine,
  withApproval,
  withTrace,
  scanKbDir,
  type KbGraph,
  type SearchConfig,
  type SearchProviderName,
} from "@lmstudio-suite/core";
import { HELP_TEXT, parseArgs } from "./args";

/** Interactive y/N gate for --approve. Prompts on stderr, reads stdin. */
async function confirmToolCall(name: string, args: unknown): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const preview = JSON.stringify(args);
    const answer = await new Promise<string>((res) =>
      rl.question(
        `\nRun ${name}(${preview.length > 120 ? preview.slice(0, 120) + "…" : preview})? [y/N] `,
        res,
      ),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.prompt) {
    process.stdout.write(HELP_TEXT + "\n");
    process.exit(args.help ? 0 : 1);
  }

  const search: SearchConfig = {
    provider:
      (process.env["SEARCH_PROVIDER"] as SearchProviderName | undefined) ??
      "duckduckgo",
    apiKey: process.env["SEARCH_API_KEY"],
    searxngUrl: process.env["SEARXNG_URL"],
  };

  const allowPrivateHosts = /^(1|true|yes)$/i.test(
    process.env["ALLOW_PRIVATE_HOSTS"] ?? "",
  );
  const timezone = args.tz?.trim() || hostTimezone();
  const tools: Tool[] = [
    ...createWebTools({ search, allowPrivateHosts }),
    ...createHttpTools({ root: args.cwd, allowPrivateHosts }),
    ...createFsTools({ root: args.cwd }),
    ...createTimeTools({ defaultTimezone: timezone }),
  ];
  if (args.shell) tools.push(createShellTool({ cwd: args.cwd }));
  if (args.data) tools.push(...createDataTools({ root: args.cwd }));
  if (args.memory) tools.push(...createMemoryTools({ root: args.memory }));
  if (args.schedule)
    tools.push(
      ...createScheduleTools({
        root: args.schedule,
        defaultTimezone: timezone,
      }),
    );

  if (args.kb) {
    const kbRoot = args.kb;
    let graph: KbGraph | undefined;
    const loadGraph = async (): Promise<KbGraph> =>
      (graph ??= (await scanKbDir(kbRoot)).graph);
    tools.push(...createMapTools({ root: kbRoot, loadGraph }));
  }

  // Decorators (innermost first): approval gates execution; trace logs the
  // outcome, including a declined call.
  let finalTools = tools;
  if (args.approve) {
    finalTools = withApproval(finalTools, { approve: confirmToolCall });
  }
  if (args.trace) {
    const tracePath = args.trace;
    finalTools = withTrace(finalTools, (t) =>
      appendFileSync(tracePath, JSON.stringify(t) + "\n"),
    );
  }

  const client = createClient();
  const model = args.model
    ? await client.llm.model(args.model)
    : await client.llm.model();

  process.stderr.write(
    `Working dir: ${args.cwd}\nTools: ${tools.map((t) => t.name).join(", ")}\n\n`,
  );

  // Prepend the current date/time so the model never has to guess it.
  const prompt = `${timeContextLine(new Date(), timezone)}\n\n${args.prompt}`;

  const result = await model.act(prompt, finalTools, {
    maxPredictionRounds: args.maxRounds,
    onRoundStart: (roundIndex: number) => {
      process.stderr.write(`\n— round ${roundIndex + 1} —\n`);
    },
    onMessage: (message: ChatMessage) => {
      const text = message.getText();
      if (!text) return;
      if (message.getRole() === "assistant") process.stdout.write(text + "\n");
      else if (message.getRole() === "tool") {
        process.stderr.write(
          `  ↳ ${text.length > 300 ? text.slice(0, 300) + "…" : text}\n`,
        );
      }
    },
    onToolCallRequestStart: (roundIndex: number, callId: number) => {
      process.stderr.write(
        `  → tool call #${callId} (round ${roundIndex + 1})\n`,
      );
    },
  });

  process.stderr.write(`\nDone in ${result.rounds} round(s).\n`);
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nAgent error: ${message}\n`);
  process.stderr.write(
    "Is LM Studio running with its local server enabled and a model loaded? " +
      "(LM Studio → Developer → Start Server)\n",
  );
  process.exit(1);
}

// The LM Studio SDK connects lazily; a failed connection rejects an internal
// promise (not the one we await), so catch it at the process level too.
process.on("unhandledRejection", fail);

run().catch(fail);
