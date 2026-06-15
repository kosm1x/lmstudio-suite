/**
 * Command allow/deny policy for run_shell.
 *
 * This is a GUARDRAIL, not a sandbox. A shell can always obfuscate intent
 * (subshells, `sh -c "…"`, `eval`, env tricks), so a determined model can step
 * around it. What it does cheaply: when an operator configures a deny/allow
 * list, block the obvious (`rm`, `curl … | sh`) at the leading executable of
 * each pipeline segment. Pair it with LM Studio's per-tool Ask/Allow prompts
 * for real gating.
 */
import { basename } from "node:path";

/**
 * The leading executable of each segment of a shell command. The command is
 * split on the pipeline/list operators `| & ; newline`; leading `VAR=val`
 * assignments are skipped; each head is reduced to its basename so that
 * `/usr/bin/rm` and `rm` are treated the same.
 */
export function commandHeads(command: string): string[] {
  return command
    .split(/[|&;\n]+/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const tokens = seg.split(/\s+/).filter(Boolean);
      let i = 0;
      while (
        i < tokens.length &&
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] as string)
      ) {
        i++; // skip env assignments like FOO=bar before the command
      }
      const head = tokens[i] ?? "";
      return head ? basename(head) : "";
    })
    .filter(Boolean);
}

export interface CommandPolicy {
  /** If non-empty, every command head must appear in this list. */
  allow?: readonly string[];
  /** Command heads that are always rejected (takes precedence over allow). */
  deny?: readonly string[];
}

/**
 * Returns a human-readable rejection reason if `command` violates `policy`,
 * or null if it is permitted. An empty policy (no allow and no deny) permits
 * everything.
 */
export function checkCommandPolicy(
  command: string,
  policy: CommandPolicy,
): string | null {
  const allow = policy.allow ?? [];
  const deny = policy.deny ?? [];
  if (allow.length === 0 && deny.length === 0) return null;

  const heads = commandHeads(command);
  if (heads.length === 0) return null;

  const denied = heads.filter((h) => deny.includes(h));
  if (denied.length > 0) {
    return `command(s) on the deny list: ${[...new Set(denied)].join(", ")}`;
  }
  if (allow.length > 0) {
    const notAllowed = heads.filter((h) => !allow.includes(h));
    if (notAllowed.length > 0) {
      return `only [${allow.join(", ")}] are allowed (saw: ${[...new Set(notAllowed)].join(", ")})`;
    }
  }
  return null;
}
