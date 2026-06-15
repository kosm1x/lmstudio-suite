# Roadmap — a full tool suite for LM Studio tool models

A working document for Claude Code sessions. Each phase is independently shippable
and written as a task list with concrete file targets, acceptance criteria, and the
commands to verify. Pick a phase, do the tasks top-to-bottom, keep the suite green.

## How to use this in a session

- **Read first:** `README.md`, `docs/LEARNINGS.md`, and the `core/tools/*` you're touching.
- **Invariant — no duplication:** every new tool is a `tool()` builder in
  `packages/core/src/tools/`, unit-tested there, then wired into a plugin **and**
  `agent-cli`. Never implement a capability twice.
- **Verify before commit:**
  ```bash
  npm run typecheck
  npx vitest run                       # or scope: npx vitest run packages/core/src/tools
  npm run package:plugins              # build assertion must pass (only sdk/zod/node:* external)
  ```
- **Conventions (non-negotiable):** ESM only; **zod v3** (`^3.25.76`) — never v4;
  network through `core/web/http.ts`; filesystem through `ScopedFs`; SSRF guards
  tested via `new URL().hostname` (see LEARNINGS). Don't set `"type":"module"` in plugin
  `package.json`.
- **Commit granularity:** one tool (or one tightly-scoped group) per commit, with its
  tests. Update the capability table in `README.md` and the plugin `README.md` in the
  same commit that ships the tool. Bump the plugin `manifest.json` `revision` when its
  shipped tool set changes.
- **Definition of done for any tool:** core builder + tests; plugin wiring; CLI wiring;
  README/table updated; `typecheck` + `vitest` + `package:plugins` all green.

## Current surface (baseline)

Callable tools today: `web_search`, `fetch_url` (web-tools); `read_file`, `write_file`,
`list_dir`, `run_shell` (local-tools); `map_overview`, `search_map`, `read_node`,
`follow_links` (kb-map). `memory` and `reasoning` are prompt preprocessors — no tools.

Suggested execution order: **Phase 1 → 2 → 4 → 3 → 5** (most felt improvement first).

---

## Phase 1 — Sharpen the existing tools (foundation)

Highest ROI; no new plugins. Goal: precise editing + retrieval + safe file ops + CI.

### 1.1 `edit_file` (surgical edits) ✅ DONE (`b627167`)

- **Files:** `packages/core/src/tools/local-tools.ts` (+ `local-tools.test.ts`); wire into
  `plugin-local/src/index.ts` and `agent-cli/src/cli.ts`.
- **Behavior:** exact-string find/replace with a uniqueness guard (fail if `old_string`
  matches 0 or >1 times unless `replace_all`); optional line-range replace. Goes through
  `ScopedFs`. Returns a short diff summary.
- **Done when:** tests cover not-found, ambiguous-match, replace_all, and a successful
  single edit; a model can edit a file without rewriting it whole.
- **Shipped:** added to `core/createFsTools` → plugin-local + agent-cli inherit it for free
  (no duplication). Literal matching (slice/concat single, split/join for `replace_all` — no
  `String.replace` `$` semantics). Two safety fixes the edit path required: `ScopedFs.readFileFull`
  (the model-facing `readFile` caps at 1MB; editing off a capped read drops the tail on write-back)
  and **atomic** `ScopedFs.writeFile` (temp + rename, so a crash mid-write can't corrupt existing
  content — also hardens `write_file`). Tests add literal-`$`, identical/empty guards, traversal,
  and a >1MB regression. qa-auditor PASS; manifest → rev 2.
- **Deferred:** line-range mode (kept one unambiguous mode); revisit if models ask for it.

### 1.2 `search_files` (content search) ✅ DONE

- **Files:** `core/src/tools/local-tools.ts` (+ test). Implement a regex walk under
  `ScopedFs` (respect a sane ignore list: `.git`, `node_modules`); cap matches + bytes.
- **Behavior:** params `pattern` (regex), optional `glob`, optional `path`. Returns
  `path:line: match` lines, truncation-marked.
- **Done when:** finds matches across nested dirs, honors ignore list, caps output.

### 1.3 `glob` / `find` ✅ DONE

- **Files:** `core/src/tools/local-tools.ts` (+ test). Glob match (e.g. `**/*.ts`) under
  the scoped root, sorted, capped.

### 1.4 File ops: `move`, `delete`, `mkdir`, `stat` ✅ DONE

- **Files:** extend `core/src/fs/scoped-fs.ts` with the primitives (+ test), then thin
  tool wrappers in `local-tools.ts`. `delete`/`move` must reject `..` escapes (already
  guarded) and refuse to operate outside root.
- **Note:** the `ScopedFs` primitives mostly already exist (`move`, `mkdir`, `remove`,
  `exists` — added for kb-map); only `stat` is missing. This task is largely the thin
  `tool()` wrappers + tests, not new fs code.

### 1.5 Harden `run_shell` ✅ DONE

- **Files:** `core/src/exec/run.ts`, `core/src/tools/local-tools.ts`.
- Truncate stdout/stderr to a byte cap; add an optional allow/deny command policy
  (`ShellToolOptions`) surfaced as a `plugin-local` config field.

### 1.6 CI ✅ DONE

- **Files:** new `.github/workflows/ci.yml`.
- Run on push/PR: `npm ci`, `npm run typecheck`, `npx vitest run`, `npm run package:plugins`
  (Node 22 matrix). This is the gate the LEARNINGS note says was missing.

**Phase 1 exit:** `local-tools` exposes read/write/**edit**/list/**search**/**glob**/
move/delete/mkdir/stat + hardened shell; CI green on the branch.

---

## Phase 2 — `data-tools` plugin (new capability class) ✅ DONE

Deterministic data + math so the model stops doing it in its head.

### 2.1 Scaffold ✅ DONE

- **Files:** new `packages/plugin-data/` (mirror `plugin-local` layout: `src/index.ts`,
  `config.ts`, `manifest.json`, `package.json`, `tsconfig.json`, `README.md`).
- Add `data-tools.ts` to `core/src/tools/` and export it from `core/src/tools/index.ts`.

### 2.2 Tools ✅ DONE

- **`calculator`** — safe arithmetic expression eval (no `eval`; use a small parser or a
  vetted dep kept external/inlined per packaging rules).
- **`query_sqlite`** — **read-only** SQL over a configured `.db` path (reject writes; cap rows).
- **`parse_json`** — JSONPath/`jq`-lite query over a file or inline string.
- **`read_csv`** — column select + filter + simple aggregate; cap rows.
- All file inputs go through `ScopedFs`.

### 2.3 Wire-up ✅ DONE

- Expose via `plugin-data` and add to `agent-cli` behind a `--data` flag.

**Phase 2 exit:** `data-tools` published-ready; capability table updated.

---

## Phase 3 — `http-tools` + richer web

### 3.1 `http_request`

- **Files:** `core/src/tools/web-tools.ts` (+ test) or a new `http-tools.ts`.
- Generic GET/POST/PUT/DELETE with headers + body, through `core/web/http.ts`, reusing the
  **audited SSRF host guard** (`allowPrivateHosts` default false; re-validate redirects;
  test via `new URL().hostname` per LEARNINGS). Cap response bytes.

### 3.2 `download_file`

- Fetch a URL into the scoped working dir (size cap, content-type note). Reuse the guard.

### 3.3 `crawl`

- Bounded same-origin fetch (depth + page cap) feeding existing `html-to-markdown`.
  Hard limits enforced; no unbounded BFS.

**Phase 3 exit:** model can hit arbitrary REST APIs and pull files/sites safely.

---

## Phase 4 — Writable memory (close the read-only loop) ✅ DONE

`memory` and `kb-map` only read today. Give the model a write path.

### 4.1 `remember` / `forget` (+`recall`) ✅ DONE

- **Files:** add tools alongside `plugin-memory` (or a shared `memory-tools.ts` in core).
- `remember(text, tags?)` appends to the knowledge dir / re-indexes; `forget(id)` removes.
  Reuse `core/rag` indexer and `core/kb` writers.

### 4.2 `store_note` ✅ DONE (already shipped as kb-map `write_node`)

- Write a frontmatter + `[[links]]` node into the kb-map graph (reuse `core/kb/frontmatter`
  - `links`). Respect the index-membership and write-extension allowlist guards from
    LEARNINGS (don't let the model write outside the graph or drop secrets in root).

**Phase 4 exit:** the always-on injection (kb-map/memory) is paired with an agentic
write path — the design completion noted in LEARNINGS.

---

## Phase 5 — Orchestration, safety & evaluation (the "suite" layer)

### 5.1 `toolkit` meta-plugin

- **Files:** new `packages/plugin-toolkit/`.
- One install exposing tool **groups** (web / fs / data / http) via config toggles, so
  users enable one plugin instead of five. Composes the same `core/tools` builders.

### 5.2 Permission / approval layer

- A confirm-before-run gate for write/delete/shell/http. In-app: a config field
  (`require_approval`); CLI: interactive prompt + `--yes` to bypass. Threaded through the
  tool `implementation` via options, not duplicated per tool.

### 5.3 Tool-call eval harness

- **Files:** new `packages/eval/` (SDK app).
- A scripted set of `.act()` tasks scoring whether a loaded model calls the **right tool
  with valid args**. Output a per-model scorecard. This is the suite's differentiator:
  help users pick a reliable LM Studio tool model, not just feed one.

### 5.4 Generator surface

- Deliver the README-promised `withGenerator` example (`packages/plugin-generator/` or a
  CLI demo) — currently listed but unbuilt.

### 5.5 Observability

- `agent-cli`: optional JSONL trace of every tool call (request args + result + round) for
  debugging agent loops. `--trace <file>`.

**Phase 5 exit:** a cohesive, safe, measurable suite — install-one ergonomics, approval
gating, and a way to rank tool models.

---

## Cross-cutting checklist (apply every phase)

- [ ] New tool implemented in `core/tools` **with tests first**, then plugin + CLI wiring.
- [ ] External-reaching tools reuse SSRF/path guards; new guards get `new URL().hostname` tests.
- [ ] `npm run typecheck && npx vitest run && npm run package:plugins` all green.
- [ ] `README.md` capability table + the plugin `README.md` updated in the shipping commit.
- [ ] Plugin `manifest.json` `revision` bumped when its tool set changes.
- [ ] No zod v4, no `"type":"module"` in plugin `package.json`, ESM throughout.
