# calc-generator

An LM Studio **Generator** plugin example. A Generator replaces the local LLM as the **token source** — instead of a model producing the assistant reply, your code does (`context.withGenerator`).

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## What it does

This example acts as a deterministic **calculator**: it reads the last user message, evaluates it as arithmetic (reusing the suite's `evalArithmetic` — `+ - * / % ^`, parentheses, no `eval`), and streams the answer back fragment by fragment via `fragmentGenerated`.

```
you:  (3 + 4) * 2 ^ 3
calc: (3 + 4) * 2 ^ 3 = 56
```

Anything that isn't arithmetic gets a one-line explanation instead.

## Why it's here

It's the minimal, runnable template for the Generator hook. The interesting line is `context.withGenerator(generate)`; `generate(ctl, history)` pulls the last user turn and calls `ctl.fragmentGenerated(...)`. Swap `respondTo` for any token source — a rules engine, a remote API, a retrieval-only responder — and you have a non-LLM "model" that plugs into LM Studio's chat UI.

MIT licensed.
