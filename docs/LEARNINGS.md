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

## Quality / audit

- We ran the qa gate as **three rounds** _after_ the first pushes (it should gate _before_). It caught real bugs each round, most importantly an SSRF hole that took two iterations to fully close.
- **Test SSRF host guards through `new URL(u).hostname`, not raw strings.** `URL.hostname` compresses IPv4-mapped IPv6 (`http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]`) and normalizes decimal/hex/octal IPv4 — a guard that only checks dotted-quad strings is bypassable. Also handle trailing-dot FQDNs (`localhost.`) and re-validate every redirect hop.

## Verifying a publish

- Hub page: `https://lmstudio.ai/<owner>/<name>` (JS-rendered — a real browser/headless render distinguishes a live page from a 404).
- Raw files: `https://lmstudio.ai/<owner>/<name>/files/<path>` serves uploaded content directly.
- In-app: the LM Studio **Developer Logs** show `Plugin(<owner>/<name>) … Register with LM Studio` on a clean load, and surface load/runtime errors.
