# eval

A **tool-call eval harness** for LM Studio models. It answers the question that actually matters when you pick a local model for agentic work: _does it call the right tool, with valid arguments?_ — not just "can it chat."

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## How it works

For each task in `src/tasks.ts` it gives the loaded model a representative toolset (web search + filesystem + data), runs an `.act()` loop, and **traces every tool call** (via the suite's `withTrace` decorator). A task passes when the model calls the expected tool with args that satisfy the task's validator **and calls no mutating tool** — every task is read-only, so a model that "sprays" every tool (writing/deleting along the way) to game the metric fails. Scoring is pure (`src/score.ts`) and unit-tested; the runner just feeds it the recorded calls and prints a scorecard (`PASS` / `BAD-ARGS` / `MUTATED` / `MISSED`).

## Run it

Needs LM Studio running with its local server on and a **tool-capable** model loaded.

```bash
npm start -w @lmstudio-suite/eval            # uses the currently-loaded model
npx tsx src/run.ts <model-id>                # or a specific model
```

Example output:

```
Tool-call scorecard — qwen2.5-7b-instruct
  PASS      arithmetic           expected calculator | called: calculator
  MISSED    web-search           expected web_search | called: (none)
  ...
  4/5 passed (80%)
```

The runner seeds a temp working directory with `notes.txt` and `people.csv` so the filesystem and CSV tasks have real inputs. Add your own tasks in `src/tasks.ts`.

MIT licensed.
