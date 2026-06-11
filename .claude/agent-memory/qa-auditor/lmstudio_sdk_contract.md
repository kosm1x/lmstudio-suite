---
name: lmstudio-sdk-contract
description: Verified @lmstudio/sdk@1.5.0 type contract for plugin/SDK integration in lmstudio-suite (entry, tool(), config schematics, preprocessor, embed, .act)
metadata:
  type: reference
---

# @lmstudio/sdk@1.5.0 contract (verified against dist/index.d.ts)

SDK install is types + dist (.cjs/.mjs/.d.ts). The `lms` CLI runner is external — the .d.ts cannot prove the entry-export _name_ (`main`), only that `main(context: PluginContext)`'s signature matches.

Source of truth: `node_modules/@lmstudio/sdk/dist/index.d.ts`. Key lines:

- `PluginContext` (6522): chained `withConfigSchematics` / `withGlobalConfigSchematics` / `withToolsProvider` / `withPromptPreprocessor` all take their hook and return `PluginContext`.
- **Variance is safe, no cast needed**: `ConfigSchematics<T>` (1469) stores `T` only in optional branded prop `[brand]?: T`. A specific `ConfigSchematics<{...}>` is assignable to `ConfigSchematics<VirtualConfigSchematics>` because each field structurally satisfies the `{key,type,valueTypeKey}` index signature (9888). `tsc -p tsconfig.json --noEmit` passes clean.
- `tool({name,description,parameters,implementation})` (9537). ctx = `ToolCallContext` (9583) = `{status, warn, signal, callId}`. Destructuring a subset is fine.
- `createConfigSchematics()` (1613) → `.field(key, valueTypeKey, params, default).build()`. Field param shapes in `kvValueTypesLibrary` (3424): select→`options:(string|{value,displayName})[]`; string→`isProtected/placeholder/minLength/...`; numeric→`int/min/max/step/slider:{min,max,step}`; boolean→`warning/...`.
- `PromptPreprocessor = (ctl, userMessage: ChatMessage) => Promise<string | ChatMessage>` (7205). Returning a plain string IS valid. `PromptPreprocessorController = Omit<ProcessingController, "createContentBlock"|"setSenderName">` (7210); ProcessingController extends BaseController → has `client`, `getPluginConfig`, `getGlobalPluginConfig`, `getWorkingDirectory`.
- `ToolsProvider = (ctl: ToolsProviderController) => Promise<Array<Tool>>` (9689). `ToolsProviderController extends BaseController` (9698, empty body) → `getWorkingDirectory(): string` (441) inherited from BaseController.
- `EmbeddingDynamicHandle.embed(string[]): Promise<Array<{embedding: number[]}>>` (2851). Array overload returns array; `.map(r=>r.embedding)` → number[][].
- `LLM.act(chat: ChatLike, tools, opts): Promise<ActResult>` (4631). `ChatLike` includes `string` (1016). `ActResult.rounds: number` (30) — NOT `.roundCount`. `onToolCallRequestStart?: (roundIndex, callId, info:{toolCallId?}) => void` (4164) — 3 params; passing a 2-param callback is assignable + safe.
- `ChatMessage.getText():string` (1042), `getRole(): "user"|"assistant"|"system"|"tool"` (1036).
- Manifest: `PluginManifest extends ArtifactManifestBase` (6560). Required: `owner`, `name` (223). `type:"plugin"`, `runner: PluginRunnerType = "ecmascript"|"node"|"mcpBridge"` (6568). `"node"` valid. `revision?`, `tags?` optional.

Audit verdict 2026-06-11: all 7 integration points used CORRECTLY. No runtime-only misuse found.
