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

## Notes

- The export is **preprocessor-only** — there is no tool, because only the preprocessor's controller exposes `pullHistory()`.
- The summary is best-effort: if the model errors or returns nothing, the **full transcript is still written** and you're told the seed was skipped.
- After a `/compact`, the model still generates a brief reply to the status note — a preprocessor can't suppress the follow-on turn. It's harmless; the useful artifacts are the two files.

MIT licensed.
