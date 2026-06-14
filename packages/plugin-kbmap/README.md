# kb-map

Give a local model **map memory**: an always-on, structural index of a folder of notes — plus tools to navigate it. The model sees _what exists_ every turn (names, paths, one-line descriptions, `[[links]]`), then drills into detail on demand. It is the structural, no-embeddings complement to the `memory` (semantic RAG) plugin — modeled on how a good index/`MEMORY.md` works: scan the map, read only what's relevant, follow links.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## How it works

Two chained hooks:

1. **Prompt Preprocessor** — prepends a compact, budgeted **map** of your knowledge base to each message. This priming is what makes the model actually reach for the tools.
2. **Tools Provider** — navigation tools the model drives itself:

| Tool                | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `map_overview`      | Show the whole map, or list one folder in full.                                                  |
| `search_map`        | Keyword search across names/paths/descriptions/tags — **incl. archived (warm) entries**.         |
| `read_node`         | Read one entry in full by its path.                                                              |
| `follow_links`      | List what an entry links to (`[[name]]`) and what links back — the associative graph.            |
| `write_node`        | Save a note (with full frontmatter) — new captures default to the `incoming/` inbox. **Opt-in**. |
| `organize_incoming` | Sort the `incoming/` inbox into folders by `type`/`tags`. Preview first, then apply. **Opt-in**. |

## Knowledge directory

Set **Knowledge directory** (global config) to the folder of `.md`/`.txt` notes you want mapped — e.g. `~/notes` (a leading `~` is expanded). Files with frontmatter (`name`, `description`, `metadata.type`, `tags`) get rich map entries; plain files fall back to a hook derived from their first heading or line — so it works on a structured KB **and** an arbitrary file tree. Leave blank to disable the plugin (it loads no tools and injects nothing until configured).

`[[wikilinks]]` in a file's body are resolved against entry `name`s to form the navigable graph; an unresolved `[[name]]` is treated as a TODO marker, not an error.

## Tiers & large knowledge bases

- **Index tier** — listed inline in the always-on map.
- **Warm tier** — folders named in **Warm (archived) folders** (default `archive`), or files with `tier: warm` frontmatter, are kept out of the injected map and reached only via `search_map`. This keeps the always-on map bounded for large archives.
- When the **Max map characters** budget is hit, the remainder of a folder collapses to a `+N more — use search_map` rollup instead of being truncated mid-entry.

## Capturing responses & sorting later

With `write_node` enabled, ask the model to "save that to my KB". It writes the note to the **inbox** (`incoming/` by default) with full frontmatter — `name`, `description`, `metadata.type`, and `tags` — so it indexes and can be sorted later. When you're ready, "organize my incoming" runs `organize_incoming`: it **previews** the moves (routing each note to a folder by its `type`, then `tags` — `type: project` → `projects/`, a `reference` tag → `references/`, …), and on confirmation moves them. Notes with no usable type/tag stay in the inbox; an existing target is reported as a conflict, never overwritten.

## Configuration

**Global:** Knowledge directory · Warm (archived) folders · Inbox folder (default `incoming`).
**Per-chat:** Inject the map each turn (default on) · Max map characters (default 4000) · Enable `write_node` (default off — also gates `organize_incoming`).

## Safety

All reads/writes/moves are confined to the knowledge directory by a path-traversal guard. The map is built from file metadata only — no embedding model, no network. `write_node` / `organize_incoming` are **off by default**; when enabled they create and move files in your knowledge directory with your user account's privileges, so only enable them for trusted models/tasks. `organize_incoming` previews before moving and never overwrites an existing file.

MIT licensed.
