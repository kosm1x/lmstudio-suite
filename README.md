# lmstudio-suite

A TypeScript suite of integrations that make **local models** (run via [LM Studio](https://lmstudio.ai)) more usable and skillful — by giving them web access, a filesystem + code sandbox, retrieval/memory, and reliable structured reasoning.

It targets **both** integration surfaces LM Studio exposes:

1. **In-app plugins** — run _inside_ the LM Studio app (Node v22 runtime), published via `lms push`.
   - **Tools Provider** — callable tools that drive agentic `.act()` flows (`context.withToolsProvider`)
   - **Prompt Preprocessor** — rewrite the user message before the model sees it; chainable (`context.withPromptPreprocessor`)
   - **Generator** — replace the local LLM as the token source (`context.withGenerator`)
   - **Custom Config** — settings schema via `createConfigSchematics` (per-chat toggles + global secrets)
2. **Standalone SDK apps** — drive LM Studio from _outside_ via `@lmstudio/sdk` (`new LMStudioClient()`, `.respond()`, `.act()`, `.embed()`).

A shared `@lmstudio-suite/core` library holds the actual capability code so both surfaces reuse one implementation.

## Capabilities

All five plugins are **published to the LM Studio Hub** under [`kosmix`](https://lmstudio.ai/kosmix) and load in the app — install with the "Run in LM Studio" button on each Hub page:
[`web-tools`](https://lmstudio.ai/kosmix/web-tools) · [`local-tools`](https://lmstudio.ai/kosmix/local-tools) · [`memory`](https://lmstudio.ai/kosmix/memory) · [`kb-map`](https://lmstudio.ai/kosmix/kb-map) · [`reasoning`](https://lmstudio.ai/kosmix/reasoning).

| Capability                        | Surface                       | Status                                                         |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| **Web search + fetch**            | Tools Provider                | ✅ live — `web-tools` plugin + core                            |
| **Filesystem + code exec**        | Tools Provider                | ✅ live — `local-tools` plugin + core                          |
| **RAG / memory (read + write)**   | Preprocessor + Tools Provider | ✅ live — `memory` plugin + core (remember/recall/forget)      |
| **Map memory (KB navigation)**    | Preprocessor + Tools Provider | ✅ live — `kb-map` plugin + `core/kb`                          |
| **Data + math (csv/json/sqlite)** | Tools Provider                | ✅ built — `data-tools` plugin + `core/data` (publish pending) |
| **Structured output + reasoning** | Preprocessor + core helpers   | ✅ live — `reasoning` plugin + core                            |
| **Standalone agent CLI**          | SDK app (`.act()`)            | ✅ built — `agent-cli`                                         |

Planned work — a phased plan to grow this into a full tool suite (surgical file editing, content search, data/SQL/HTTP tools, writable memory, an eval harness) lives in **[docs/ROADMAP.md](docs/ROADMAP.md)**.

### Web search backends

`webSearch()` is provider-pluggable and works with **zero config** via DuckDuckGo (keyless HTML):

- `duckduckgo` (default, no key)
- `tavily` (API key)
- `brave` (API key)
- `searxng` (self-hosted instance URL)

## Layout

```
lmstudio-suite/
├── packages/
│   ├── core/                 @lmstudio-suite/core — shared capability library
│   │   └── src/
│   │       ├── client.ts     LMStudioClient helpers (standalone apps)
│   │       ├── web/          search + fetch + html→markdown        ✅
│   │       ├── fs/           ScopedFs (path-guarded file ops)      ✅
│   │       ├── exec/         runShell / runNode (timeout + caps)   ✅
│   │       ├── rag/          chunk + cosine VectorStore + index    ✅
│   │       ├── reasoning/    extractJson + generateStructured + CoT ✅
│   │       ├── kb/           frontmatter + [[links]] graph + map digest ✅
│   │       ├── data/         calculator + csv + jsonpath + sql-readonly  ✅
│   │       └── tools/        shared SDK tool() builders (web/fs/shell/map/data) ✅
│   ├── plugin-web/           ✅ Tools Provider (web_search + fetch_url)
│   ├── plugin-local/         ✅ Tools Provider (read/write/edit/search/glob/file-ops + opt-in run_shell)
│   ├── plugin-memory/        ✅ Preprocessor (RAG) + opt-in write tools (remember/recall/forget)
│   ├── plugin-kbmap/         ✅ Preprocessor + Tools Provider (map memory over a KB)
│   ├── plugin-reasoning/     ✅ Prompt Preprocessor (chain-of-thought scaffolding)
│   ├── plugin-data/          ✅ Tools Provider (calculator + json/csv readers + read-only sqlite)
│   └── agent-cli/            ✅ Standalone .act() agent composing all suite tools
└──
```

The plugins and the CLI consume one set of tool implementations from `core/tools`
(`createWebTools` / `createFsTools` / `createShellTool`) — no duplication between
the in-app and standalone surfaces.

### Run the `web-tools` plugin in LM Studio

```bash
cd packages/plugin-web
lms dev          # build + hot-reload into the running LM Studio app
# then enable "web-tools" in a chat; pick a model that supports tool use and
# the model can call web_search / fetch_url. Configure provider/keys in settings.
```

### Package the plugins for `lms push`

The plugins import the shared workspace package `@lmstudio-suite/core`, which is **not published to npm** — so a plugin folder can't be pushed as-is. `npm run package:plugins` produces self-contained, push-ready directories under `dist-plugins/`, one per plugin:

```bash
npm run package:plugins        # owner comes from each manifest (kosmix)
# or override: npm run package:plugins -- --owner <your-lms-hub-handle>
# → dist-plugins/{web-tools,local-tools,memory,reasoning}/
#   each: manifest.json · package.json (lms-plugin-<name>) · package-lock.json ·
#         tsconfig.json · src/index.ts  (self-contained bundle)

cd dist-plugins/web-tools
lms push        # publishes to the LM Studio Hub (run `lms login` first)
```

How it works: each plugin's entry is esbuild-bundled with `@lmstudio-suite/core` **inlined** (tree-shaken to only what that plugin uses; the HTML parser is inlined into `web-tools`), while `@lmstudio/sdk` and `zod` stay **external** — both are provided by the plugin runtime, and zod must be the _same instance_ the SDK uses for `tool()` schema extraction (hence the v3 pin). The generated `package-lock.json` resolves `zod@3.x` + `@lmstudio/sdk@1.5.0`. `dist-plugins/` is git-ignored — regenerate it whenever `core` or a plugin changes.

> Manifests use the LM Studio Hub handle `kosmix` (the GitHub repo is `kosm1x/lmstudio-suite` — these are different handles). Override with `--owner <handle>` if publishing under a different account. For local iteration without publishing, `lms dev` from a `packages/plugin-*` folder works directly against the monorepo.

### Run the standalone agent CLI

Drives a local model with the whole toolset via `.act()` (LM Studio must be running with its local server on and a model loaded):

```bash
# from the repo root
npm start -w @lmstudio-suite/agent-cli -- "Find the latest LM Studio release and write a summary to notes.md" --shell
# options: -m/--model <id>, --cwd <dir>, --max-rounds <n>, --shell, -h/--help
# web search backend via env: SEARCH_PROVIDER, SEARCH_API_KEY, SEARXNG_URL
```

The agent always has `web_search`, `fetch_url`, `read_file`, `write_file`, `edit_file`, `search_files`, `glob`, `list_dir`, `stat_path`, `move_file`, `make_dir`, `delete_file`; `--shell` adds `run_shell`.

## Develop

Requires Node ≥ 22 (matches LM Studio's plugin runtime).

```bash
npm install
npm run typecheck                       # tsc --noEmit across all packages
npx vitest run packages/core/src/web    # scoped test run (full suite runs in CI)
```

> Note: building/running the in-app plugins requires the `lms` CLI and a running LM Studio instance (desktop app). The `core` library and its tests run anywhere with Node.

## Troubleshooting

- **`Error rendering prompt with jinja template: "Cannot call something that is not a function: got UndefinedValue"`** when `web-tools`/`local-tools` are enabled. The tools providers inject tool definitions, and your **model's chat template can't render tools**. Load a **tool-capable model** (it shows a tool/hammer badge in LM Studio; prefer `lmstudio-community` builds, which ship fixed templates) or override the prompt template. The `memory`/`reasoning` preprocessors add no tools and work with any model.
- **`require is not defined in ES module scope`** at plugin load → the plugin `package.json` has `"type": "module"`; remove it (LM Studio bundles to CommonJS). The packaging script already omits it.
- **`local-tools` operates on a temp sandbox, not my project** → set the plugin's **Working directory** config field to your project folder (e.g. `~/projects/my-app`). LM Studio has no "attach a folder to a chat" feature, so this field is how you point the tools at real files. (`This prediction process is not attached to a working directory` is the same root cause — no directory set; the tools fall back to a temp sandbox.)
- **A new config field / fix doesn't show up after `lms push`** → installed plugins don't auto-update. Update/reinstall the plugin in LM Studio (`⋯` → update, or reinstall from the Hub). Confirm the change is published first via `lmstudio.ai/<owner>/<name>/files/src/index.ts`.
- **`lms push` rejected / wrong account** → `manifest.owner` must equal your LM Studio Hub handle (not necessarily your GitHub handle).

Full build/publish/runtime notes: **[docs/LEARNINGS.md](docs/LEARNINGS.md)**.

## Conventions

- **ESM only**, `moduleResolution: Bundler` (downstream is bundled by `lms`/esbuild/tsx — no `.js` import churn).
- **Zod v3** (`^3.25.76`) — pinned to match `@lmstudio/sdk`'s `tool()` peer requirement; do **not** upgrade to zod v4.
- Network requests go through `core/web/http.ts` for consistent timeouts + abort handling.

## License

MIT
