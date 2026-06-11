---
name: lmstudio-suite-overview
description: What lmstudio-suite is, its declared safety posture, and package layout
metadata:
  type: project
---

# lmstudio-suite

TypeScript monorepo (npm workspaces, ESM, vitest). Gives a **local** LM Studio model
real capabilities: web search/fetch, scoped filesystem, optional shell, RAG memory.
Located `/root/claude/lmstudio-suite` (its own git repo, not the parent `/root/claude`).

## Declared safety posture (honest in comments)

- `exec/run.ts` self-describes as "resource-bounded, NOT a security sandbox" — accurate. Child runs with host privileges.
- `fs/scoped-fs.ts` guards path-string traversal only; explicitly disclaims symlink-inside-root escape in header comment.
- These are correct for a **local dev tool**. Severity must be calibrated to that threat model: the operator already trusts the machine; the real risk surface is a _prompt-injected_ or adversarial **model** abusing tools, plus secret leakage.

## Package layout

- `packages/core/src/fs/scoped-fs.ts` — ScopedFs (resolvePath guard, maxReadBytes)
- `packages/core/src/exec/run.ts` — runShell/runNode, process-group kill, timeout
- `packages/core/src/web/{url,fetch,http,search}.ts` — web layer; `isPrivateHost` lives in url.ts
- `packages/core/src/tools/{local,web}-tools.ts` — SDK tool() builders shared by plugins + CLI
- `packages/plugin-{web,local,memory,reasoning}` — LM Studio plugins
- `packages/agent-cli/src/cli.ts` — standalone agent CLI

## Confirmed-sound (do not re-flag without new evidence)

- `ScopedFs.resolvePath` (scoped-fs.ts:44-52): the `relative()` + `rel===".."` + `startsWith(".."+sep)` + `isAbsolute(rel)` triad is correct. Absolute paths, `../`, and nested `../../../` all rejected (tested). The only real gap is symlinks-inside-root (disclaimed).
