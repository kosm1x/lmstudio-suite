# local-tools kata

A tiny, zero-dependency experiment for testing the **local-tools** plugin (from
lmstudio-suite) on your local LM Studio. The model has to drive
`list_dir → read_file → write_file → run_shell` in a real fix-until-green loop.

`src/textkit.js` ships with 3 deliberately broken functions. The suite in
`test/textkit.test.js` (10 tests, runs on Node's built-in `node --test`, no npm
install) defines the correct behavior. Success = all 10 green.

## Setup in LM Studio (in-app plugin path)

1. **Get this folder onto your machine.** `git pull` the lmstudio-suite repo and
   it's under `experiments/local-tools-kata/`.
2. **Load a tool-capable model.** Required — a non-tool model throws
   `Cannot call something that is not a function` on every message. Prefer an
   `lmstudio-community` build with the tool/hammer badge.
3. **Enable the `local-tools` plugin** in this chat.
4. **Set the plugin's "Working directory"** config field to the **real absolute
   path of this folder on your machine**. Get it by running, in your local clone:
   `cd experiments/local-tools-kata && pwd` — paste that exact output (e.g.
   `/Users/you/dev/lmstudio-suite/experiments/local-tools-kata`). The path must
   exist locally; a wrong/foreign path makes every tool fail (see Troubleshooting).
5. **Turn on "Enable run_shell"** in the plugin config (off by default) so the
   model can run the tests.
6. LM Studio per-tool permissions: `read` = Allow, `write`/`shell` = Ask is a
   sane default for watching what it does.
7. Paste the prompt from `PROMPT.md`.

## Setup via agent-cli (better dir control)

From the repo root, with LM Studio's local server running and a tool-capable
model loaded. agent-cli runs via `tsx` (no build step); the task is a
**positional** argument, `--cwd` scopes the file/shell tools, `--shell` enables
`run_shell`:

```bash
npm start -w @lmstudio-suite/agent-cli -- \
  --cwd experiments/local-tools-kata \
  --shell \
  "Fix the failing tests in this project. Run 'node --test', read the failures, fix src/textkit.js only (do not edit the test file), and iterate until all tests pass."
```

It defaults to the currently loaded model (override with `-m <id>`), 8
prediction rounds (`--max-rounds`). agent-cli always also has the web tools;
they're just unused here.

## Scoring — what to watch for

- **Did it use the tools at all**, or hallucinate edits in prose? (tool-capable
  model + plugin enabled is the gate.)
- **Did it `run_shell` the tests** before and after, or claim done blindly?
- **Iteration**: does it re-run after a partial fix and catch the remaining
  failures? `wordCount('')` and the exact-length `truncate` are the subtle ones.
- **Scope discipline**: did it touch only `src/textkit.js` and leave the tests
  alone?

## Reset between runs

```bash
git checkout -- experiments/local-tools-kata/src/textkit.js
# and delete test/initials.test.js if you ran the harder variant
```

## Verify by hand

```bash
cd experiments/local-tools-kata && node --test
```

Broken state = 8 fail / 2 pass. Solved = 10 pass.

## Troubleshooting

- **`run_shell` returns `spawn /bin/sh ENOENT`** (and `list_dir`/`read_file`
  also fail) → the configured **Working directory does not exist on this
  machine**. It is not a missing-shell or Windows problem. Set the field to the
  real local `pwd` of this folder (step 4). Sanity check: the first `list_dir .`
  should show `src`, `test`, `package.json` — if it says `(empty directory)` the
  path is still wrong. (Newer plugin builds report this as
  `working directory does not exist: <path>` instead of the cryptic ENOENT.)
- **Every message errors with `Cannot call something that is not a function`** →
  the loaded model isn't tool-capable. Switch to a tool/hammer-badge model.
