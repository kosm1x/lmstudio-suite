# memory

A retrieval-augmented **memory** for local models. Before the model answers, this prompt-preprocessor retrieves the most relevant snippets from a folder of your notes/docs and injects them as context — grounding answers in your own knowledge base.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## How it works

On each message it embeds your query with an LM Studio embedding model, finds the top matching chunks from your knowledge directory (cosine similarity over a local vector index), and prepends them to the prompt. Indexing is cached and only re-runs when files change. Any failure passes your message through unchanged — retrieval never blocks you.

## Configuration

**Global:**

- **Embedding model** — identifier of a loaded LM Studio embedding model (e.g. `text-embedding-nomic-embed-text-v1.5`).
- **Knowledge directory** — absolute path to a folder of `.md`/`.txt` files. Leave blank to disable.

**Per-chat:**

- **Snippets to retrieve** (top-K, default 4)
- **Minimum similarity** (0–1, default 0.35)
- **Max injected context characters** (default 2000)
- **Enable memory write tools** (off by default) — see below.

## Writable memory (closing the loop)

Retrieval is read-only on its own. Turn on **Enable memory write tools** to also expose three tools so the model can save what it learns:

| Tool       | What it does                                                           |
| ---------- | ---------------------------------------------------------------------- |
| `remember` | Save a fact as a markdown note (frontmatter + tags) under `memories/`. |
| `recall`   | Keyword-search saved memories and return matches with their ids.       |
| `forget`   | Delete a saved memory by id.                                           |

Because a remembered note is just a markdown file **in the knowledge directory**, the retrieval index rebuilds on the next message and the new fact becomes retrievable automatically — no separate store. (For structured, linked notes, use the `kb-map` plugin's `write_node`.)

## Use

Point it at a notes folder and load an embedding model, then chat normally — relevant context is added automatically. Enable the write tools if you want the model to grow that folder over time.

MIT licensed.
