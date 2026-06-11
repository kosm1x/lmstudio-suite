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

## Capabilities (planned)

| Capability                        | Surface                          | Status                                 |
| --------------------------------- | -------------------------------- | -------------------------------------- |
| **Web search + fetch**            | Tools Provider                   | ✅ built — `web-tools` plugin + core   |
| **Filesystem + code exec**        | Tools Provider                   | ✅ built — `local-tools` plugin + core |
| **RAG / memory**                  | Prompt Preprocessor + embeddings | ✅ built — `memory` plugin + core      |
| **Structured output + reasoning** | Preprocessor + core helpers      | ✅ built — `reasoning` plugin + core   |
| **Standalone agent CLI**          | SDK app (`.act()`)               | ✅ built — `agent-cli`                 |

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
│   │       └── tools/        shared SDK tool() builders (web/fs/shell) ✅
│   ├── plugin-web/           ✅ Tools Provider (web_search + fetch_url)
│   ├── plugin-local/         ✅ Tools Provider (read/write/list_dir + opt-in run_shell)
│   ├── plugin-memory/        ✅ Prompt Preprocessor (RAG over a knowledge dir)
│   ├── plugin-reasoning/     ✅ Prompt Preprocessor (chain-of-thought scaffolding)
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

The agent always has `web_search`, `fetch_url`, `read_file`, `write_file`, `list_dir`; `--shell` adds `run_shell`.

## Develop

Requires Node ≥ 22 (matches LM Studio's plugin runtime).

```bash
npm install
npm run typecheck                       # tsc --noEmit across all packages
npx vitest run packages/core/src/web    # scoped test run (full suite runs in CI)
```

> Note: building/running the in-app plugins requires the `lms` CLI and a running LM Studio instance (desktop app). The `core` library and its tests run anywhere with Node.

## Conventions

- **ESM only**, `moduleResolution: Bundler` (downstream is bundled by `lms`/esbuild/tsx — no `.js` import churn).
- **Zod v3** (`^3.25.76`) — pinned to match `@lmstudio/sdk`'s `tool()` peer requirement; do **not** upgrade to zod v4.
- Network requests go through `core/web/http.ts` for consistent timeouts + abort handling.

## License

MIT
