/**
 * Minimal glob → RegExp for matching POSIX-style relative paths.
 *
 * Supported:
 *   star       — any run of characters within a single path segment (not slash)
 *   question   — exactly one non-separator character
 *   doublestar — followed by a slash: any number of directory segments (incl. zero)
 *   doublestar — at the end: anything, crossing slashes
 *
 * Not supported: brace `{a,b}` or character-class `[a-z]` expansion. The match
 * is anchored (full string). Keep it small and dependency-free — the suite's
 * packaging keeps only sdk/zod/node:* external, so no `minimatch`.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++; // consume the second '*'
        if (glob[i + 1] === "/") {
          i++; // consume the '/'
          re += "(?:[^/]*/)*"; // zero or more path segments
        } else {
          re += ".*"; // '**' at end → anything, crossing '/'
        }
      } else {
        re += "[^/]*"; // '*' → within one segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c; // escape regex metacharacters
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** True if `path` (POSIX-separated) matches `glob`. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}
