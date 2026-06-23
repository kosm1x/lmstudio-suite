# compact

Type **`/compact`** in a chat to **export the whole conversation to a file** and get a paste-ready **seed summary** for a fresh chat. The local model's own `/compact`.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

> ⚠️ **A plugin cannot clear the LM Studio chat.** The SDK's `pullHistory()` returns a _copy_ — there is no truncate/reset API, and only a prompt preprocessor can read history at all (tools can't). So "compact" here means **export + seed**, not wipe. Clearing the context is the **New Chat** button; this plugin hands you a summary to carry across.

## How it works

Send a message that **starts with** the trigger (default `/compact`, optionally followed by a note):

1. The prior conversation is written to `compact-<timestamp>.md` (the `/compact` message itself is excluded).
2. If "write a seed summary" is on, the current model summarizes the conversation into `compact-<timestamp>.seed.md`.
3. Your message is replaced with a status note pointing at both files and showing the summary.

Then open **New Chat** and paste the summary to continue with less context.

```
/compact ship notes
→ [compact] Exported this conversation.
  - Transcript: …/compact-2026-06-21-1432.md
  - Seed:       …/compact-2026-06-21-1432.seed.md

  Summary for the next chat:
  We were building plugin-compact; chose a preprocessor because tools
  can't pullHistory… next: wire docs + ship.
```

## Configuration

- **Compact trigger** — the word that fires an export (default `/compact`). Must be the start of the message; `/compacting` and `please /compact` do **not** match.
- **Export directory** — folder for the `.md` + `.seed.md` files. Blank = the plugin's per-prediction working directory.
- **Timezone** — IANA name (e.g. `America/Mexico_City`) for the filename timestamp. Blank = this machine's timezone.
- **Enable /compact** — watch for the trigger (on by default).
- **Write a seed summary** — also summarize via the current model (one extra model call per `/compact`; on by default). Turn off for a raw export with no model call.
- **Max tokens per summary call** (default `4000`) — the token budget for each summarization call. A long conversation is summarized in chunks of this size, then merged. **Set it below your model's loaded context length.** It can't be auto-detected: LM Studio's SDK reports the model's _maximum_ context, not the window you loaded, so the plugin would over-size and overflow. Default `4000` is safe on essentially any model; raise it toward your context length (e.g. `24000` for a 32k load) for fewer, faster chunks.
- **Summary instructions** — _what_ the seed should be. **Blank = a built-in, complete, well-narrated hand-off briefing written for the agent that resumes the work** (who/what/why/how/when: full recap, characters, decisions + reasons, open threads, and exactly where you left off — flowing prose, thorough but information-dense, no reasoning). Override to tailor it, e.g. `Recap the story, characters, key choices, and exactly where we left off, as a complete briefing for the writer who picks this up.` The conversation is appended automatically.
- **Summary length cap (tokens)** (default `2048`) — the seed's room to work: the summary aims to be **as complete as the material needs**, up to this many output tokens. Raise it for long conversations (a thorough narrated seed can want 2000–4000), lower for terser seeds. **Counts reasoning tokens too** — if your model "thinks" heavily and seeds come out cut off, raise it. (The default instruction tells the model not to emit reasoning, so output is mostly the seed itself.)

## Notes

- The export is **preprocessor-only** — there is no tool, because only the preprocessor's controller exposes `pullHistory()`.
- **Long conversations are summarized in chunks (map-reduce).** A conversation that won't fit the budget is split into **Max tokens per summary call**-sized parts (measured with the model's tokenizer), each part summarized, then the part-notes merged into one seed. This is slower (several model calls) but means compaction works on exactly the big conversations that need it, instead of overflowing the context and producing nothing.
- The summary is best-effort: if the model errors or returns nothing, the **full transcript is still written** and you're told why (the failure reason, or that the model returned nothing).
- After a `/compact`, the model still generates a brief reply to the status note — a preprocessor can't suppress the follow-on turn. It's harmless; the useful artifacts are the two files.

MIT licensed.
