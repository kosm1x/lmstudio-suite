# toolkit

The **whole lmstudio-suite in one plugin**. Install `toolkit`, point it at a working directory, and toggle the tool groups you want — instead of installing and configuring five separate plugins.

Part of [lmstudio-suite](https://github.com/kosm1x/lmstudio-suite).

## Groups (toggle per chat)

| Group       | Tools                                                                 | Default |
| ----------- | --------------------------------------------------------------------- | ------- |
| Web         | `web_search`, `fetch_url`                                             | on      |
| HTTP        | `http_request`, `download_file`, `crawl`                              | off     |
| Filesystem  | `read/write/edit/search/glob/list/stat/move/make_dir/delete` (scoped) | on      |
| Shell       | `run_shell` (runs with your privileges)                               | off     |
| Data + math | `calculator`, `parse_json`, `read_csv`, `query_sqlite`                | on      |
| Memory      | `remember`, `recall`, `forget` (markdown notes under the working dir) | off     |
| KB map      | `map_overview`, `search_map`, `read_node`, `follow_links`             | off     |

It composes the exact same `core/tools` builders the individual plugins use — there is no second implementation, so behavior (path scoping, SSRF guard, row/byte caps) is identical.

## Configuration

**Global:**

- **Working directory** — where the file / data / memory / kb-map / download tools operate (`~` expanded; temp fallback).
- **Web search provider / API key / SearXNG URL** — for the Web group.
- **Allow private/localhost hosts** — off by default (SSRF guard for Web + HTTP).

**Per-chat:** one on/off switch per group (see the table above).

## When to use it

Reach for `toolkit` when you want one capable agent and don't want to manage several plugins. Reach for the individual plugins (`web-tools`, `local-tools`, `data-tools`, `memory`, `kb-map`) when you want only one capability or finer-grained config.

MIT licensed.
