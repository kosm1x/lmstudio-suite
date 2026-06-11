---
name: core-library-audit
description: Verified correctness gotchas in @lmstudio-suite/core (web/rag/reasoning/exec/fs)
metadata:
  type: project
---

# @lmstudio-suite/core — verified correctness gotchas

Stack: ESM, moduleResolution Bundler, noUncheckedIndexedAccess, zod v3 (pinned INTENTIONALLY — never flag), node-html-parser v7. Tests: vitest, 61 passing at audit time.

Verified by running tsx repros (not speculation):

- **node-html-parser `.text` on `<pre>` with child `<code>` returns raw inner HTML INCLUDING literal `<code>`/`</code>` tags.** So `html-to-markdown.ts` `pre` case (`node.text`) leaks tags into the fence for the most common code-block structure `<pre><code>...</code></pre>`. The existing test only covers text-only `<pre>`. Fix: strip child tags / use a child-aware text extraction or render children with whitespace-preserving text.
- **`isPrivateHost` (web/url.ts) is dead code** — exported, doc says "opt-in per tool", but NO tool calls it; `fetchPage` only calls `parseHttpUrl`. SSRF guard is dormant. When enabled it has gaps: `[::1]` (URL.hostname keeps brackets → `h === "::1"` never matches), `0.0.0.0`, IPv6 `fe80::`/`fc00::`/`fd00::`, decimal IP `2130706433`, octal, short-form `127.1` all bypass. 172.16/12 boundary itself is CORRECT (tested 172.15/172.32 allow, 172.16–31 block).
- **`extractJson` (reasoning/extract-json.ts) bracket-pick is positional**: picks `[` or `{` whichever appears FIRST. `"See item [1]: {\"a\":1}"` → returns `[1]` silently. Also the fence regex captures the FIRST ` ` `block even if it holds no JSON, then hard-throws instead of falling back to whole-text scan. Inline`code``` in prose breaks it.
- **run.ts `chunk.toString("utf-8")` per data event corrupts multi-byte UTF-8 split across chunks** (→ replacement chars). Needs StringDecoder. Object-literal eval order for `truncated` IS correct (appears after clamp() calls). `maxOutputBytes` measured in UTF-16 `.length`, not bytes.
- **scoped-fs `resolvePath` guard is SOLID** — `....//x`, `..\x` (POSIX literal), `/abs`, `a/../../b` all handled correctly. Don't flag it.
- **cosineSimilarity returns NaN for NaN/Infinity inputs** (doc only promises 0-for-zero). `VectorStore.query` throws on FIRST length-mismatched stored vector, aborting the whole query (one bad entry poisons retrieval). NaN scores silently filtered even with default minScore=-Infinity; Array.sort with NaN is unstable.
- **chunkText hard-split emits a redundant tail window** fully contained in the prior window (e.g. cs10/ov5 on 25 chars → last window dupes). Wasteful, not incorrect.
- node-html-parser `.rawText` does NOT pre-decode entities → `decodeEntities(node.rawText)` is single-decode, CORRECT. Don't flag double-decode.
