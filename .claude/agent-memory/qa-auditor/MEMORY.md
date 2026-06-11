# qa-auditor memory — lmstudio-suite

Index of topic files. Read the relevant one before auditing similar code.

- [project_overview.md](project_overview.md) — what lmstudio-suite is, its safety posture, per-package layout, and confirmed-sound code (don't re-flag)
- [core-library-audit.md](core-library-audit.md) — verified correctness gotchas in `@lmstudio-suite/core` (node-html-parser `.text` on `<pre><code>`, isPrivateHost SSRF gaps, extractJson bracket-pick, run.ts utf-8 chunk split)
