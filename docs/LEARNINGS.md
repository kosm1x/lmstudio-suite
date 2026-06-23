# Learnings — building & shipping LM Studio plugins

Hard-won notes from building, auditing, packaging, and publishing this suite. If you fork or extend it, read this first.

## Building against the SDK

- **Pin zod to v3.** `@lmstudio/sdk@1.5.0` peer-depends on `zod@^3` and extracts JSON schema from your `tool()` Zod params via `zod-to-json-schema`. zod 4 breaks `tool()`. We pin `zod@^3.25.76`, deduped to a single instance shared with the SDK.
- **Verify the SDK API against its `.d.ts`, not the docs.** The shipped types are the source of truth. Confirmed there: `main(context: PluginContext)` entry; `withToolsProvider` / `withPromptPreprocessor` / `withGenerator` / `with*ConfigSchematics`; `tool({name,description,parameters,implementation})` with ctx `{status,warn,signal,callId}`; `ActResult.rounds` (not `.roundCount`); config field types (`select`/`string`(`isProtected`)/`numeric`/`boolean`).
- **`ctl.getWorkingDirectory()` throws** `"This prediction process is not attached to a working directory."` when the chat has no folder attached. Never call it eagerly in a tools provider — the whole tool list fails to load in a plain chat. Wrap in try/catch and fall back (we use a temp sandbox).

## Packaging for `lms push`

The plugins import the unpublished workspace package `@lmstudio-suite/core`, so a plugin folder can't be pushed as-is. `npm run package:plugins` builds self-contained dirs under `dist-plugins/`:

- **esbuild-bundle each entry with core inlined**, keeping `@lmstudio/sdk` + `zod` **external** (runtime-provided; zod must stay the SDK's instance). A build assertion fails if anything but `sdk`/`zod`/`node:*` survives un-bundled.
- **Do NOT set `"type": "module"`** in the plugin `package.json`. LM Studio compiles each plugin to a **CommonJS** `.lmstudio/production.js` (it emits `require()` for external deps). With `type: module`, Node loads that CJS output as ESM and crashes: `ReferenceError: require is not defined in ES module scope`. The official plugins omit the `type` field — match that.
- Each plugin needs `manifest.json`, `package.json`, **`package-lock.json`**, and a `README.md` (shown on its Hub page).

## Publishing

- **`manifest.owner` must be your LM Studio Hub handle** — which may differ from your GitHub handle. (Here the GitHub repo is `kosm1x/lmstudio-suite` but the Hub account is `kosmix`.) `lms push` rejects a mismatch.
- Run `lms login` once, then `lms push` from inside the plugin directory. The Hub manages revisions server-side.
- **zsh eats `#`.** Interactive zsh has `interactive_comments` off by default, so a pasted `lms push   # comment` becomes `lms push` plus stray args → `too many arguments for 'push'`. Run commands without trailing inline comments.

## Runtime / model compatibility

- **Tools providers require a tool-capable model.** If the loaded model's chat template can't render tool definitions, enabling `web-tools`/`local-tools` makes every message fail with: `Error rendering prompt with jinja template: "Cannot call something that is not a function: got UndefinedValue"`. This is the model's template (often a missing `raise_exception` in a branch your tools trip), not the plugin. Fix: load a model with the **tool/hammer badge**, preferring `lmstudio-community` builds (fixed templates), or override the prompt template.
- **Prompt preprocessors (`memory`, `reasoning`) are model-agnostic** — they only modify the message text, add no tools, and work with any model.
- **There is no "attach a folder to a chat" feature in LM Studio.** `getWorkingDirectory()` only ever returns an auto per-chat sandbox (or throws). For a filesystem plugin to operate on a real project, expose your **own config field** for the base directory (we added `local-tools`' "Working directory", with `~` expansion; peer plugins default to `~/`). The `ScopedFs` path-guard still confines the model to whatever directory is configured.
- **Installed plugins do NOT auto-update.** `lms push` publishes a new Hub revision, but an already-installed copy keeps its old code _and config schematics_ until you update/reinstall it in the app (`⋯` menu → update, or uninstall + reinstall from the Hub). If a new config field "doesn't show up," the install is stale — verify the field landed via `…/files/src/index.ts` on the Hub, then reinstall.
- **For real coding on a specific folder, the standalone `agent-cli` (`--cwd <dir> --shell`) is the better fit** than the in-app plugin — you control the directory directly and it runs an autonomous `.act()` loop, no per-message tool toggling or plugin reinstalls.
- **A summarize/compact call that embeds the whole conversation overflows context _exactly when compaction is needed_.** `compact`'s first version stuffed the full transcript into one `tokenSource().respond()` call; on a big chat the request exceeded the model's context (`request (35431 tokens) exceeds the available context size (32256 tokens)`), the `try/catch` swallowed it, and `/compact` silently produced no seed. The token source carries no chat history, so those tokens were all the re-sent transcript. Fix: **chunked map-reduce** — summarize each context-sized part, then merge the part-notes. Diagnosis tip: `lms log stream` shows the failing prediction task and the exact token-overflow error, and proves the preprocessor itself fired (`[PromptPreprocessor][Request …] completed`).
- **You cannot auto-detect the LOADED context — both `getModelInfo().contextLength` and `getContextLength()` report the model MAXIMUM.** This was the long tail of the compact bug. Attempt 1 budgeted from `getContextLength()` → overflowed. Attempt 2 switched to `getModelInfo().contextLength` (documented as the _loaded_ instance window) → **still overflowed**: in LM Studio with Llama 4, both report the model's max (~99k, the "est" in the llama.cpp slot logs), not the window you loaded (e.g. 32–35k). So there is **no SDK call that returns the loaded context** in this setup, and any auto-sized budget over-sizes → the "fits in one call?" check passes → it single-shots the whole transcript → overflow. This survives every reinstall because it's the _number_, not the code. **Resolution: don't probe — expose a config field** (`Max tokens per summary call`, default a safe 4000) the user sets to fit their loaded context. Same pattern as `local-tools`' working-directory: when the SDK can't tell you something reliably, let the user declare it. Keep `countTokens()` for accurate single-shot/chunk sizing and **reserve the instruction-wrapper tokens** (chunk text + preamble is what's sent). `tokenSource()` returns `LLM | LLMGeneratorHandle`; only `LLM` has `countTokens`, so feature-detect (`"countTokens" in source`, else a chars/4 estimate).
- **3-strike discipline that would have saved hours:** the single >context-size request in `lms log stream` proved map-reduce wasn't running, which I kept attributing to a stale install. When "redeploy the fix" fails three times with the identical symptom, the bug is in an assumption (here: that any SDK method returns the loaded context), not the deployment — stop redeploying and challenge the assumption (or grep the installed `production.js` for a per-revision marker to rule deployment in/out).
- **`lms push` ≠ updating the installed plugin, and the install can be stubborn.** Pushing uploads a new Hub revision; the running app keeps the old code. Reinstalling _while LM Studio runs_ may not swap the in-memory plugin — on Windows you must **quit from the system tray** (closing the window leaves it running), then reinstall. To prove which revision is actually loaded, grep the on-disk install for a marker unique to the new build (we used a per-revision identifier like `getModelInfo`), rather than trusting that "reinstalled" took.

## Quality / audit

- We ran the qa gate as **three rounds** _after_ the first pushes (it should gate _before_). It caught real bugs each round, most importantly an SSRF hole that took two iterations to fully close.
- **Test SSRF host guards through `new URL(u).hostname`, not raw strings.** `URL.hostname` compresses IPv4-mapped IPv6 (`http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]`) and normalizes decimal/hex/octal IPv4 — a guard that only checks dotted-quad strings is bypassable. Also handle trailing-dot FQDNs (`localhost.`) and re-validate every redirect hop.

## kb-map — structural "map memory" (a third retrieval style)

- **Three retrieval styles, not two.** `memory` = semantic RAG (embeddings, top-K, similarity threshold; opaque chunks). `local-tools` = raw fs (the model crawls blind). `kb-map` = a structural, always-on index + agentic navigation — the port of how a good `MEMORY.md` works (scan the map, read only what's relevant, follow `[[links]]`). It needs **no embedding model**: cheap, deterministic, structure-aware. Reach for it when structure/relationships matter and you want the model to drive; reach for RAG when fuzzy semantic recall matters.
- **Inject the map AND expose the tools.** The preprocessor-injected digest is the priming ("you have a memory, here's its shape") that makes a model actually call the tools; the tools (`map_overview`/`search_map`/`read_node`/`follow_links`) give depth a one-shot injection can't. Either alone underperforms.
- **A budget that isn't a hard bound silently bloats every-turn context.** First cut only triggered the "+N more" rollup _inside_ a folder's node loop, so the per-folder heading + first entry always emitted — a one-folder-per-note vault blew `maxChars` by up to ~38× (warm tier had no budget check at all). Fix: account headings + the warm section in the running total, gate rollup on the running total (not "have I shown ≥1 here"), and **reserve headroom so the trailing summary always fits** — otherwise you stay under budget but drop the "+N more" marker, i.e. silently truncate.
- **Scope a read tool to the index, not just the root.** `read_node` originally read any file under the KB root via ScopedFs. ScopedFs blocks `..` traversal but not a `.env`/key that simply _sits_ in the root — `collectKbFiles` hides it from the map, but the model could still read it by path. Gate the read to entries present in the graph (membership check), and allowlist write extensions. The traversal guard and the visibility policy are two different controls.

## Tool design — editing files & shared builders

- **Put a capability in `core/tools` once; plugins and the CLI inherit it.** `edit_file` is a
  single `tool()` builder inside `createFsTools`, so both the `local-tools` plugin and `agent-cli`
  gained it with zero wiring. The roadmap invariant ("never implement a capability twice") is not
  bureaucracy — it's what makes one commit ship a tool everywhere.
- **A model-facing read and an edit read are different reads.** `ScopedFs.readFile` caps at 1MB to
  protect context; a file-editing tool that reads through it and writes the result back **silently
  truncates everything past the cap**. Edits must use a separate non-truncating read (`readFileFull`).
  The >1MB regression test exists to keep that wired — if someone "simplifies" edit_file back onto the
  capped read, an over-cap `old_string` reads as not-found and the test fails loudly.
- **Mutating an existing file means writing atomically.** Truncate-in-place (`writeFile(path, …)`) is
  fine for create/overwrite but for `edit_file` a crash mid-write loses _existing_ content. Stage to a
  sibling temp file and `rename()` into place — atomic within a filesystem, and a same-dir temp is on
  the same filesystem. (qa-auditor flagged this; we folded the fix in rather than queuing it, since
  not-corrupting-files is the whole point of an edit tool.)
- **Literal find/replace, not `String.prototype.replace`.** `String.replace(str, repl)` treats `$&`,
  `$1`, `$\`` in the replacement as special — a model replacing code containing `$` gets corruption.
  Use `indexOf` + slice/concat for the single case and `split(old).join(new)` for `replace_all`; both
  are fully literal. Test it explicitly (`new_string: "$1$&"`).
- **Make the unique-match contract the default and fail closed.** `edit_file` requires `old_string` to
  match exactly once unless `replace_all`; not-found / ambiguous / empty / identical-old==new all
  return an error **before any write**. A model that gets "matches 3 times, add context or set
  replace_all" self-corrects; one that silently edited the first match would corrupt quietly.
- **Idempotent writes break write-loops; a generic success feeds them.** A local model driving
  `toolkit` re-wrote the same file 4× (each agentic round ~10 min of model latency, not tool time —
  there is no embed/re-index on a write). The tool's contribution: `write_file`/`write_node` returned
  the same `Wrote N characters` on every call, even for byte-identical content, so a model that
  re-decided to write got **no "already done" signal** and looped. Fix: `ScopedFs.writeFileIfChanged`
  (compare the FULL existing content — not the capped read — and skip the write if identical), and have
  the tool return a distinct terminal no-op: `No change: … already contains exactly this content — do
not write it again.` The 2nd–Nth identical write becomes a free no-op the model reads as "stop." Same
  class for `remember`: a no-`id` retry used to spawn `note-2`, `note-3`…; now it reuses the same-fact
  note's id so the retry updates in place (new tags included) instead of duplicating. The read-back
  `.catch(() => null)` only ever forces a write attempt (ENOENT _or_ a real read error surfaces through
  the write) — it can never fabricate a false "already saved." Idempotency only catches _identical_
  re-writes; for a model that varies content each round, the backstops are LM Studio's per-tool
  Ask/Allow approval and a lower max-prediction-rounds.

## Growing the suite (patterns from the Phase 1–5 roadmap build)

- **One core builder, every consumer.** Every tool is a `tool()` builder in `core/tools`, wired into a
  plugin AND `agent-cli`. Adding `edit_file`/`search_files`/etc. to `createFsTools` lit them up in the
  plugin and the CLI at once. The `toolkit` meta-plugin and the `eval` harness just compose the same
  builders — no capability is implemented twice, so the path guard / SSRF guard / caps are identical
  everywhere.
- **CI earns its keep immediately.** The first full `vitest run` in CI caught a plugin test that had
  silently broken three commits earlier — per-phase _scoped_ runs never executed it. Scope runs for
  speed while iterating; gate on the whole suite.
- **`node:sqlite` is the dependency-free SQL story** (Node ≥22): open `{ readOnly: true }` (the engine
  rejects writes) AND pre-check SELECT/WITH-only — neither alone. Stream results with `.iterate()` and
  stop at the row cap; `.all()` materialises the whole set and the "cap" becomes display-only. Same
  trap for file readers: cap the _read_ (stat-then-refuse), not just the rows shown.
- **One audited network path.** `guardedFetch` follows redirects manually and re-validates **every**
  hop's host against the SSRF guard before contacting it (a public URL can 30x into `169.254.169.254`).
  `fetch_url`, `http_request`, `download_file`, and `crawl` all route through it; default-deny private
  hosts at every layer. The guard keys on `URL.hostname` (normalises IPv4-mapped IPv6, trailing-dot
  FQDNs), not a smuggle-able Host header.
- **Writable memory closes the loop for free.** `remember` writes a markdown note _into the knowledge
  dir the RAG plugin indexes_, so the index rebuilds on the next message and the fact is retrievable —
  no separate store. Lesson the auditor caught: a model-controlled `id` (in `forget`) must be sanitized
  the _same way_ as the write path (`remember` slugified; `forget` didn't → `forget("../note")` deleted
  real notes). `ScopedFs` guards the root, not a subdir.
- **Decorate tools, don't fork them.** `withApproval` / `withTrace` wrap any `Tool[]`, overriding only
  `implementation` so the SDK schema + `checkParameters` survive. Keep the mutating-tool list complete
  or a new writer is silently un-gated. In-app approval is LM Studio's per-tool Ask/Allow — the wrapper
  is for the CLI, opt-in (`--approve`) so non-interactive runs don't hang.
- **A tool-selection eval must resist spray-all.** Giving every task the full toolset and passing on
  "expected tool appeared once" lets a model that calls _everything_ score 100%. Since the tasks are
  read-only, failing any task where a _mutating_ tool was called (plus stronger arg validators) makes
  the metric measure selection, not coverage.
- **A meta-plugin only subsumes Tools Providers — not preprocessors or generators.** `toolkit`
  composes every `core/tools` group behind per-chat toggles, so it can replace the plugins that are
  _pure_ `withToolsProvider` (`web-tools`, `local-tools`, `data-tools`). It **cannot** replace
  `reasoning` (`withPromptPreprocessor`), `calc-generator` (`withGenerator`), or the _injection_ half
  of `memory` / `kb-map` (those are preprocessor + tools — `toolkit` carries their tools but not their
  always-on prompt injection). The dividing line is the SDK hook, not the feature: a tools provider has
  no way to rewrite the prompt or replace the token source, so anything riding a different hook stays a
  separate plugin. (User-facing keep/drop guidance lives in the README.)
- **Adding a workspace package means re-running `npm install`.** A new `packages/*` workspace must be
  registered in the root `package-lock.json`, but `typecheck` / `vitest` / `package:plugins` all reuse
  the existing `node_modules` and never notice the drift — only `npm ci` does, which is exactly what CI
  runs. We added four workspaces and CI went red on the install step (`npm ci` refuses a lockfile that
  doesn't list every workspace). Fix: `npm install` to resync the lockfile, commit it, CI greens. Run
  `npm install` (not just the test trio) whenever you add a workspace, or CI is the first thing to tell
  you.

## Date/time (the `time` plugin / `core/time`)

- **Inject the clock; never read it inside the logic.** Every function in `core/time` takes the
  instant it operates on, so it's pure and unit-testable; `createTimeTools({ now })` and the plugin
  are the only places a real `new Date()` appears. Tests pass a fixed `now` and assert exact strings —
  no flakiness, no fake timers. (`now`/`time_until` would be untestable otherwise.)
- **`Intl` is the dependency-free timezone story** (same shape as the `node:sqlite` lesson). DST-aware
  offsets come from an `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" }).formatToParts()`
  round-trip (format the instant in the zone, diff against `Date.UTC` of those parts). No `luxon` /
  `date-fns-tz` dependency — which also keeps the plugin bundle assertion green (only `sdk`/`zod`/`node:*`).
  `Date.UTC` months are 0-based — the off-by-one bites here.
- **A wall-clock string is not an instant.** An offset-less datetime is interpreted as _host-local_ per
  the ECMAScript spec, so `convert_timezone` needs an explicit `from` to anchor it; pass a `Z`/offset to
  be unambiguous. Two foot-guns we closed by surfacing rather than guessing: (a) a DST spring-forward
  _gap_ time (e.g. 02:30 on the jump day) doesn't exist — it's documented + test-pinned, not silently
  shifted; (b) `parseDate("2026")` used to become Jan 1 silently — now a bare integer that isn't 10-digit
  unix seconds is rejected. A wrong-but-plausible date is worse than a clear error.
- **`time` is another "preprocessor + tools" plugin, so it gets its own plugin, not a toolkit group
  alone.** `toolkit` carries the five date/time tools (`enableTime`) but a Tools Provider can't inject
  the always-on "Current date and time: …" line — that rides `withPromptPreprocessor`, so it lives in
  `plugin-time` (alongside `memory`/`kb-map`). Same dividing line as the meta-plugin lesson above: the
  SDK hook, not the feature.

## Scheduling (the `schedule` plugin / `core/schedule`)

- **A plugin cannot run on a timer, so scheduling splits in two.** An LM Studio plugin's hooks
  (`toolsProvider`/`promptPreprocessor`/`generator`) fire only while the model is responding — there
  is no background tick. A true cron therefore can't live in a plugin. The design: an **authoring
  half** (this plugin writes JSON job specs to a directory) + an **execution half** (a separate
  scheduler daemon, run on the same machine, reads that directory and fires jobs). Phase 1 is the
  authoring half; it is **inert until the daemon runs**, and every tool message + the README say so
  rather than implying a job will execute.
- **Idempotent authoring needs a spec/timestamp split.** `writeFileIfChanged` makes a re-write a
  no-op only if the bytes match — but a job carries an `updatedAt` that would change on every save and
  defeat it. Fix: separate the user-authored _spec_ fields from the runtime/bookkeeping fields, compare
  the spec (`specEquals`), and **only stamp `updatedAt` when the spec actually changed** (`upsertSpec`
  short-circuits to "unchanged" otherwise, preserving `createdAt` and runtime state). That makes
  re-issuing the same `schedule_task` a true no-op — the same loop-breaking contract as the write tools.
- **Sanitize a model-controlled id before it becomes a path.** The store writes
  `<dir>/schedules/<id>.json`; `ScopedFs` guards the _root_ but not a crafted `../` inside the subdir
  (exactly the hole the memory `forget` tool once had). Run every id-taking tool through `toScheduleId`
  (the same slugify the create path uses) so `cancel`/`update`/`run_now` can't escape. Pin it with a
  traversal test (`"../../etc/passwd"` → `etc-passwd`).
- **Validate, don't parse, when the dependency is the cost.** Cron _validation_ (field count, ranges,
  lists, steps) is a dependency-free regex/range check that lives in the plugin. Computing the next
  fire time needs a real parser (`cron-parser`) — so that belongs in the **non-plugin** daemon, which
  can take the dep freely; putting it in the plugin would break the bundle's "only sdk/zod/node:\*
  external" assertion. Draw the line at where the dependency would land.

## The scheduler daemon (`packages/scheduler/`)

- **Put a dependency where it can't leak.** Computing cron fire times needs `cron-parser`, but
  a plugin bundle may only carry sdk/zod/node:* (the `package:plugins` assertion). So the daemon
  — a non-plugin workspace — owns that dep; `core/schedule` stays *validation-only\*. The Phase 1
  (plugin/core) ↔ Phase 2 (daemon) split is literally drawn at the dependency boundary. Verify by
  grepping the dep out of every plugin bundle, not just trusting tree-shaking.
- **Test an I/O daemon by injecting its I/O behind a port.** The whole daemon is timers + LM Studio
  - fs, which looks untestable — but the _decisions_ aren't. Inject the clock and put the firing
    behind a `runJob` port, and `tickOnce` becomes a pure state machine you test against a real temp
    store with a fake `runJob` (no LM Studio, no fake timers). Only the thin real `act-runner` (the
    actual `.act()` + run-log write) stays untested; everything that decides _what_ happens is covered.
- **Catch-up collapse + strict-after = no double/missed fire.** Recompute "is it due" from
  `lastRunAt` each tick (single source of truth; a stored `nextRunAt` is display-only and would
  drift). `cron-parser`'s `next()` returns the occurrence _strictly after_ the baseline — that
  strictness is what stops a same-tick re-fire. And because the post-fire baseline jumps to `now`,
  a backlog of occurrences missed while the daemon was down collapses to **one** catch-up fire, not
  a stampede. (Probe the real parser to confirm strict-after — don't assume.)
- **A poll loop must be unkillable.** Wrap each tick in try/catch (LM Studio being down is not the
  daemon dying), `await` the tick before sleeping (no overlapping ticks), and on SIGTERM finish the
  current tick before exit (no half-written job file). Set `lastRunAt` even on a _failed_ fire so a
  broken job waits for its next occurrence instead of hammering every poll.
- **Unattended ≠ interactive — tighten the blast radius.** Defaults that are fine for the
  hand-driven CLI are riskier for a daemon firing model-chosen tools while you're away: gate
  `run_shell` behind an explicit operator opt-in (`--allow-shell`, off), and default the jobs'
  working dir to a `work/` subdir so their fs tools can't rewrite the schedule specs. And be honest
  that crash safety is **at-least-once** (a kill after `.act()` but before the save re-fires on
  restart) — the right tradeoff for side-effecting jobs, but say so rather than claiming exactly-once.
- **Best-effort enrichment must never fail the primary operation.** The `--kb` routing (write the
  run result into the KB as a kb-map node) is _secondary_ — the run already succeeded and its run log
  is on disk. An un-try/caught KB write would let a disk hiccup throw out of `runJob`, which `tickOnce`
  reads as a _failed run_ — mislabeling success, and permanently for a one-shot that's already fired
  and disabled. Wrap the secondary write, log, and swallow. A side effect downstream of the real work
  must not be able to fail the real work.
- **Interpolating a model-authored field into frontmatter is an injection vector.** The KB node's
  `description:` embeds `job.name`; a name with newlines + `tier: warm` / `metadata:\n  type: project`
  could break out and flip the node's tier/type. Defense: `oneLine()` (collapse whitespace) **plus** a
  wrapping prefix (`description: Scheduled run of "<name>" at …`) keep it trapped in one scalar. Pin it
  with a _hostile-input round-trip_ test (build the note, `scanKbDir`, assert no type/tier flip) — a
  happy-path round-trip alone wouldn't catch a future refactor to a bare `description: ${job.name}`.
- **An anti-spray eval that bans all mutating calls can't score a mutating tool.** The tool-call eval
  fails any task where a mutating tool was called (catches a model that sprays writes) — but a
  `schedule_task`/`cancel_schedule` task's _correct_ answer IS a mutating call, so it self-failed.
  Fix: exclude the task's _own expected tool_ from the mutating penalty (other mutating sprays still
  fail). And when you add mutating tools, grep-sweep the `MUTATING_TOOLS` set so `--approve` gating and
  the eval both see them.

## The `compact` plugin (`core/compact` + a preprocessor)

- **A plugin can read the conversation but can't clear it.** The only SDK surface that exposes the
  chat is `ProcessingController.pullHistory()`, and it's available **only to a prompt preprocessor**
  (a `ToolsProviderController` is empty — tools can't see history). And `pullHistory()` returns a
  **copy**: "mutating it will not affect the actual history." There is no truncate/reset API. So a
  local-model `/compact` can only mean **export + seed**, never wipe — clearing is the host's New
  Chat button. State that limit loudly rather than pretending to deliver the literal ask. (The local
  model that proposed `run_shell("/clear")` hallucinated a CLI and confused Claude Code's slash
  command for a shell verb — read the SDK before believing a generated design.)
- **A preprocessor can't suppress the turn it sits on.** It returns the (replacement) user message
  and generation proceeds — there's no way to short-circuit. So `/compact` returns a self-contained
  status note (file paths + summary) and accepts that the model then emits a brief reply to it. Don't
  design around suppression you don't have; design the returned message to read well as the last word.
- **The seed summary is a nested generation via `tokenSource()`.** The preprocessor calls
  `(await ctl.tokenSource()).respond(prompt)` — the same model the user has selected, pre-wired to
  their config — then `stripReasoning()` peels any `<think>…</think>` a local model emits. Make it
  best-effort: the **full transcript is written first**, and a model error only costs the seed, never
  the export. Same "secondary must not fail primary" rule as the daemon's `--kb` write.
- **Keep the host-agnostic half in `core` and unit-test it without the SDK.** Trigger parsing,
  transcript rendering, the summary prompt, reasoning-strip, and the timezone-aware filename stamp are
  all pure functions over `{role, text}` records — tested against fixed instants, no LM Studio. The
  plugin is just the glue (pull history → map to records → write files → call the model). Match the
  trigger only at the **start** of a message and require trailing whitespace, or `/compacting` fires it.

## Enforcing the KB graph convention at the write path (`core/kb/lint`)

- **A graph view links by links, never by folders.** Obsidian's (and the suite's) graph draws an
  edge only when one note references another with `[[wikilink]]`; folder structure creates zero
  edges. So "files appear unlinked" is almost always "the notes don't name each other," not a config
  problem. The fix is a convention, and a convention only holds if something enforces it.
- **Two graphs, one overlap.** The suite's KbGraph resolves `[[X]]` by the frontmatter **`name:`**
  (falling back to filename) and reads links from the **body**; Obsidian resolves by the **filename**
  (or `aliases:`) and reads body + frontmatter-property links. The intersection that works in both is
  **a body `[[link]]` with `name:` == filename**. A present-but-different `name:` is the silent killer:
  kb-map indexes the note under a name that no `[[filename]]` link resolves to. (A _missing_ `name:` is
  fine — both fall back to the filename.)
- **Enforce at the write tool, don't just instruct.** `write_node` previously _described_ the
  convention in its prose and trusted the model — which is why misnamed/orphan notes still landed. Now
  the tool gates every write through `checkNoteForWrite`: it **auto-corrects** `name:` to the filename
  (deterministic, unambiguous → just fix it silently) and **refuses** the write when frontmatter or a
  body `[[link]]` is missing (only the author can supply those → return an actionable error). The
  invalid note never reaches disk. Description-as-spec is a hope; a write-path gate is a guarantee.
- **Auto-fix what's deterministic, reject what needs a human/model decision.** Splitting the two is the
  ACI win: the model isn't nagged about the filename (the tool owns that), only about the one thing it
  must decide — what to link.
- **A write-path gate can't see files written any other way.** Hand-edited notes, an imported vault, or
  a generic file-writer bypass it. So `lint_map` (read-only) audits the whole graph — name≠filename,
  isolated (no in _and_ no out links — a note only _linked-to_ is still connected), and dangling links.
  Enforcement = prevention at the tool + detection across the vault.
- **Strict-on-every-write was a deliberate call.** Requiring a link even on an `incoming/` quick-capture
  adds friction to the deferred-sort inbox flow — but relaxing it there would re-admit the exact
  floating-dot bug the feature exists to kill. "Enforce always" means always; the tool teaches the
  requirement up front so the cost is one `## Related` line.

## Verifying a publish

- Hub page: `https://lmstudio.ai/<owner>/<name>` (JS-rendered — a real browser/headless render distinguishes a live page from a 404).
- Raw files: `https://lmstudio.ai/<owner>/<name>/files/<path>` serves uploaded content directly.
- In-app: the LM Studio **Developer Logs** show `Plugin(<owner>/<name>) … Register with LM Studio` on a clean load, and surface load/runtime errors.
- **A built artifact "missing" on the publish machine is usually a stale checkout, not a push problem.** `dist-plugins/` is git-ignored, but the bundles are **force-committed** (`git add -f`) so any machine gets push-ready dirs via `git pull` — no local rebuild needed. When a freshly built plugin's dir didn't exist on the Mac (`cd dist-plugins/<name>` → "no such file"), the cause was a checkout that predated the commit, not a bad bundle or an `lms` bug. `git checkout main && git pull` fixed it. When a force-committed gitignored artifact appears to be missing on another machine, suspect the checkout before the tool.
