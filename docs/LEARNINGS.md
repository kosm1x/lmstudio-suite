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

## Verifying a publish

- Hub page: `https://lmstudio.ai/<owner>/<name>` (JS-rendered — a real browser/headless render distinguishes a live page from a 404).
- Raw files: `https://lmstudio.ai/<owner>/<name>/files/<path>` serves uploaded content directly.
- In-app: the LM Studio **Developer Logs** show `Plugin(<owner>/<name>) … Register with LM Studio` on a clean load, and surface load/runtime errors.
- **A built artifact "missing" on the publish machine is usually a stale checkout, not a push problem.** `dist-plugins/` is git-ignored, but the bundles are **force-committed** (`git add -f`) so any machine gets push-ready dirs via `git pull` — no local rebuild needed. When a freshly built plugin's dir didn't exist on the Mac (`cd dist-plugins/<name>` → "no such file"), the cause was a checkout that predated the commit, not a bad bundle or an `lms` bug. `git checkout main && git pull` fixed it. When a force-committed gitignored artifact appears to be missing on another machine, suspect the checkout before the tool.
