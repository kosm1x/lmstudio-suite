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
| **Web search + fetch**            | Tools Provider                   | 🟢 core built (search + html→markdown) |
| **Filesystem + code exec**        | Tools Provider                   | ⏳ planned                             |
| **RAG / memory**                  | Prompt Preprocessor + embeddings | ⏳ planned                             |
| **Structured output + reasoning** | Generator / preprocessor         | ⏳ planned                             |
| **Standalone agent CLI**          | SDK app (`.act()`)               | ⏳ planned                             |

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
│   └── core/                 @lmstudio-suite/core — shared capability library
│       └── src/
│           ├── client.ts     LMStudioClient helpers (standalone apps)
│           ├── web/          search + fetch + html→markdown  ✅
│           ├── fs/           scoped filesystem ops            (planned)
│           ├── exec/         sandboxed shell / JS exec        (planned)
│           ├── rag/          embeddings + vector store        (planned)
│           └── reasoning/    structured output + retry/CoT    (planned)
└── (plugin packages + agent CLI added per capability)
```

Each in-app plugin ships as its own package (manifest.json + package-lock.json) so it can be published independently with `lms push`; plugins import `@lmstudio-suite/core` and are bundled at build time.

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
