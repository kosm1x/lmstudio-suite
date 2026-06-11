# reasoning

Add **chain-of-thought scaffolding** to each message, helping smaller local models reason before they answer. A lightweight prompt-preprocessor — no tools, no setup.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Configuration (per-chat)

- **Reasoning mode:**
  - **Off** — pass the message through unchanged.
  - **Concise** (default) — "think step by step, then give a concise final answer".
  - **Full** — explicit reasoning followed by a marked `Final answer:` line.

## Use

Enable it in a chat and pick a mode. It appends the reasoning instruction to your message before the model sees it.

> Note: this shapes the model's _input_. For hard schema/JSON enforcement on the _output_, use `generateStructured` from [`@lmstudio-suite/core`](https://github.com/kosm1x/lmstudio-suite) in a standalone SDK app.

MIT licensed.
