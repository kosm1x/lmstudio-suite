---
name: core-library-audit
description: Verified correctness gotchas in @lmstudio-suite/core (web/rag/reasoning/exec/fs)
metadata:
  type: project
---

# @lmstudio-suite/core — verified correctness gotchas

Stack: ESM, moduleResolution Bundler, noUncheckedIndexedAccess, zod v3 (pinned INTENTIONALLY — never flag), node-html-parser v7. Tests: vitest, 61 passing at audit time.

Verified by running tsx repros (not speculation):

## R2 (commit d8c7fd6 "Fix issues found by multi-round qa-auditor") — re-verified

- **isPrivateHost IPv4-mapped IPv6 bypass — STILL OPEN after the fix (CONFIRMED end-to-end via fetchPage to a real loopback listener).** url.ts lines 43-44 handle only the _dotted_ `::ffff:` form (`h.slice(7)` then dotted-quad regex), but WHATWG `new URL().hostname` ALWAYS compresses IPv4-mapped IPv6 to hex (`http://[::ffff:127.0.0.1]/` → hostname `[::ffff:7f00:1]`). So the dotted branch is effectively dead and every mapped form bypasses: loopback `[::ffff:7f00:1]`, metadata `[::ffff:a9fe:a9fe]`, private `[::ffff:a00:1]`, also `[::7f00:1]` (IPv4-compatible) and NAT64 `[64:ff9b::7f00:1]`. Node undici connects mapped-IPv6 to the IPv4 addr → real SSRF. The redirect loop in fetch.ts IS structurally correct (re-guards each hop before fetch, line 63 before 64) but calls the same broken guard, so a public 302→`[::ffff:169.254.169.254]` reaches metadata. Fix: parse the `::ffff:`/`::` hex tail back to IPv4 (last 32 bits) and run the v4 checks; also block all `::ffff:`/`::`-prefixed + `64:ff9b::` embedded-v4. Tests never round-trip through `new URL().hostname` (they pass raw `"fc00::1"`) so they miss it.
- **html-to-markdown stripTags re-parse — NEW REGRESSION (worse than the bug it fixed).** node-html-parser `.text` ALREADY entity-decodes, so `<code>&lt;div&gt;</code>` gives `node.text === "<div>"`. stripTags sees `/<\/?[a-zA-Z]/` match → re-parses `"<div>"` as HTML → `.structuredText === ""` → content DELETED. `<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>` → `alert(1)` (tags stripped). Any doc page showing HTML/JSX/XML in code blocks gets mangled/emptied. PLUS double-decode: code/pre do `decodeEntities(stripTags(node.text))` but node.text is already decoded → `<pre>&amp;lt;x&amp;gt;</pre>` (literal `&lt;x&gt;`) comes out `<x>`. Fix: stripTags should operate on `node.rawText` (un-decoded) not `node.text`, OR drop the re-parse and walk child text nodes; and remove the second decodeEntities. The pre+code regression test passes only because `const a = 1;` has no tag-like escaped content.
- extract-json.ts "largest top-level parseable value" rewrite is SOUND — re-ran 7 adversarial cases incl. prose `[1]` vs real obj, nested-largest, array-of-objects, brace-in-string. No new failure mode found (picks largest by span length; region priority json-fence→any-fence→whole-text holds). No extract-json.test.ts exists though.
- run.ts StringDecoder fix is GOOD — decoders flushed via `.end()` in both close+error handlers, 0 replacement chars on €×5000 / 中×60000 split tests, truncated flag + marker work. Note: maxOutputBytes still measured in UTF-16 `.length` not bytes (misnomer, pre-existing, not a bug).
- vector-store.ts query fix is GOOD — dim-mismatch `continue` skip + cosine NaN/Inf→0 guard both verified (wrongdim entry excluded from results; NaN vector scores 0).

## R1 (original) findings:

- **node-html-parser `.text` on `<pre>` with child `<code>` returns raw inner HTML INCLUDING literal `<code>`/`</code>` tags.** So `html-to-markdown.ts` `pre` case (`node.text`) leaks tags into the fence for the most common code-block structure `<pre><code>...</code></pre>`. The existing test only covers text-only `<pre>`. Fix: strip child tags / use a child-aware text extraction or render children with whitespace-preserving text.
- **`isPrivateHost` (web/url.ts) is dead code** — exported, doc says "opt-in per tool", but NO tool calls it; `fetchPage` only calls `parseHttpUrl`. SSRF guard is dormant. When enabled it has gaps: `[::1]` (URL.hostname keeps brackets → `h === "::1"` never matches), `0.0.0.0`, IPv6 `fe80::`/`fc00::`/`fd00::`, decimal IP `2130706433`, octal, short-form `127.1` all bypass. 172.16/12 boundary itself is CORRECT (tested 172.15/172.32 allow, 172.16–31 block).
- **`extractJson` (reasoning/extract-json.ts) bracket-pick is positional**: picks `[` or `{` whichever appears FIRST. `"See item [1]: {\"a\":1}"` → returns `[1]` silently. Also the fence regex captures the FIRST ` ` `block even if it holds no JSON, then hard-throws instead of falling back to whole-text scan. Inline`code``` in prose breaks it.
- **run.ts `chunk.toString("utf-8")` per data event corrupts multi-byte UTF-8 split across chunks** (→ replacement chars). Needs StringDecoder. Object-literal eval order for `truncated` IS correct (appears after clamp() calls). `maxOutputBytes` measured in UTF-16 `.length`, not bytes.
- **scoped-fs `resolvePath` guard is SOLID** — `....//x`, `..\x` (POSIX literal), `/abs`, `a/../../b` all handled correctly. Don't flag it.
- **cosineSimilarity returns NaN for NaN/Infinity inputs** (doc only promises 0-for-zero). `VectorStore.query` throws on FIRST length-mismatched stored vector, aborting the whole query (one bad entry poisons retrieval). NaN scores silently filtered even with default minScore=-Infinity; Array.sort with NaN is unstable.
- **chunkText hard-split emits a redundant tail window** fully contained in the prior window (e.g. cs10/ov5 on 25 chars → last window dupes). Wasteful, not incorrect.
- node-html-parser `.rawText` does NOT pre-decode entities → `decodeEntities(node.rawText)` is single-decode, CORRECT. Don't flag double-decode.
