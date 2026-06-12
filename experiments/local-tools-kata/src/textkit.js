// textkit — small string helpers.
//
// Three of these functions are BUGGY. The test suite in test/textkit.test.js
// describes exactly how each one is supposed to behave. Your job is to read the
// tests, fix the bugs in this file, and run the suite until everything passes.
//
// Do NOT edit the test file. Only fix the implementations below.

/**
 * Convert a title into a URL slug.
 *   - lowercase everything
 *   - replace any run of whitespace with a single hyphen
 *   - drop every character that is not a-z, 0-9, or a hyphen
 *   - collapse repeated hyphens into one
 *   - trim leading/trailing hyphens
 * e.g. "  Hello, World!  " -> "hello-world"
 */
export function slugify(title) {
  // BUG: only swaps spaces; leaves case and punctuation untouched.
  return title.replace(/ /g, "-");
}

/**
 * Truncate `text` so the returned string is at most `maxLen` characters.
 *   - if text.length <= maxLen, return it unchanged
 *   - otherwise cut it and append a single "…" (U+2026) so that the
 *     returned string's length is EXACTLY maxLen
 * e.g. truncate("hello world", 8) -> "hello w…"  (length 8)
 */
export function truncate(text, maxLen) {
  // BUG: ignores maxLen entirely.
  return text;
}

/**
 * Count the words in `text`. Words are runs of non-whitespace separated by
 * whitespace. Leading/trailing whitespace must not inflate the count, and an
 * empty or whitespace-only string has 0 words.
 * e.g. wordCount("  a  b c ") -> 3 ; wordCount("") -> 0
 */
export function wordCount(text) {
  // BUG: "".split(/\s+/) is [""] (length 1), and leading spaces add empties.
  return text.split(/\s+/).length;
}
