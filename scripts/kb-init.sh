#!/usr/bin/env bash
# kb-init.sh — scaffold a knowledge base for the kb-map LM Studio plugin.
#
# Creates a folder structure + seed notes that demonstrate every convention
# kb-map indexes: frontmatter (name/description/type/tags), [[wikilinks]], the
# no-frontmatter fallback, and an archive/ folder that maps to the warm tier.
# Idempotent — it never overwrites a file that already exists.
#
# Usage:  bash kb-init.sh [target-dir]    (default: ~/knowledge-base)
set -euo pipefail

KB_DIR="${1:-$HOME/knowledge-base}"
TODAY="$(date +%Y-%m-%d)"

# archive/ is kb-map's default "warm" tier (searchable, not in the always-on
# map). Everything else shows in the map.
for d in projects areas notes references daily archive templates; do
  mkdir -p "$KB_DIR/$d"
done

# seed <relative-path> ; content on stdin. Skips files that already exist.
seed() {
  target="$KB_DIR/$1"
  if [ -e "$target" ]; then echo "skip (exists): $1"; return 0; fi
  mkdir -p "$(dirname "$target")"
  cat > "$target"
  echo "created:       $1"
}

seed "README.md" <<'EOF'
# Knowledge Base

Organized for the **kb-map** LM Studio plugin (structural "map memory").

## Note format

Each note is Markdown with YAML frontmatter so the map indexes it richly:

```
---
name: short-kebab-slug         # other notes reference it by this name
description: one-line summary   # the hook shown in the map
metadata:
  type: project | note | reference | area | daily
tags: [topic, topic]
---

# Title

Body. Link a related note by writing its name in double square brackets — see
projects/example-project.md for a working example.
```

Files with no frontmatter still work — the map derives a hook from the first heading.

## Folders

- `projects/`   active work, one file per project
- `areas/`      standing topics / areas you maintain over time
- `notes/`      atomic notes and ideas (one idea per file)
- `references/` external resources, docs, links
- `daily/`      daily logs
- `archive/`    closed/old material — the map's **warm tier** (searchable via search_map, not shown in the always-on map)
- `templates/`  copy-paste templates (warm)

## Use with kb-map

1. LM Studio -> enable the kb-map plugin.
2. Set **Knowledge directory** (global config) to this folder's **absolute path**.
3. Ask a tool-capable model about your notes — it gets the map each turn and can
   `map_overview` / `search_map` / `read_node` / `follow_links`.
EOF

seed "projects/example-project.md" <<'EOF'
---
name: example-project
description: Template project — replace with a real one.
metadata:
  type: project
tags: [example]
---

# Example Project

What it is and its current status.

- Related idea: [[example-note]]
- Reference: [[example-reference]]
EOF

seed "areas/example-area.md" <<'EOF'
---
name: example-area
description: Template area — a standing topic you maintain over time.
metadata:
  type: area
tags: [example]
---

# Example Area

An ongoing area of responsibility or knowledge.
EOF

seed "notes/example-note.md" <<'EOF'
---
name: example-note
description: Template atomic note — one idea per file.
metadata:
  type: note
tags: [example]
---

# Example Note

One idea, captured atomically. Links back to [[example-project]].
EOF

seed "notes/quick-capture.md" <<'EOF'
# Quick capture

No frontmatter needed — the map derives a hook from this first heading.
Add frontmatter later when the note matures.
EOF

seed "references/example-reference.md" <<'EOF'
---
name: example-reference
description: Template reference — a pointer to an external resource.
metadata:
  type: reference
tags: [example]
---

# Example Reference

- URL: https://example.com
- Why it matters: ...
EOF

seed "archive/example-archived.md" <<'EOF'
---
name: example-archived
description: A closed item — lives in the warm tier.
metadata:
  type: note
---

# Example Archived Note

Old/closed material. kb-map keeps `archive/` out of the injected map but reachable
via search_map.
EOF

seed "templates/note.md" <<'EOF'
---
name: note-template
description: Copy the block below to start a new note.
tier: warm
metadata:
  type: reference
---

# Note template

Copy this into a new file under `projects/`, `notes/`, etc.:

```
---
name: my-new-note
description: one-line summary
metadata:
  type: note
tags: [topic]
---

# Title

Body. Link related notes with [[their-name]].
```
EOF

seed "daily/$TODAY.md" <<EOF
---
name: $TODAY
description: Daily log for $TODAY
metadata:
  type: daily
---

# $TODAY

-
EOF

echo
echo "Knowledge base ready. Absolute path (paste this into kb-map's \"Knowledge directory\"):"
( cd "$KB_DIR" && pwd )
