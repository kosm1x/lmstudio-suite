# Prompt to paste into the LM Studio chat

Paste the block below as your first message once the plugin is enabled and the
working directory is set to this kata folder. It deliberately does NOT spell out
the fixes — the point is to see whether the model drives the tools on its own.

---

You are working in a small Node.js project. Use your file and shell tools.

1. List the project files to get your bearings.
2. Run the test suite with `node --test` and read the failures.
3. The file `src/textkit.js` has bugs. Read it and the tests in
   `test/textkit.test.js` to understand the intended behavior.
4. Fix `src/textkit.js` only. Do not edit the test file.
5. Re-run `node --test` and keep iterating until every test passes.

Report what was broken and what you changed.

---

## Harder variant (optional)

After it passes, ask for a new feature to test write-from-scratch + tests:

> Add an exported function `initials(name)` to `src/textkit.js` that returns the
> uppercase initials of each word (e.g. "ada lovelace" -> "AL"). Then add a test
> file `test/initials.test.js` covering empty input, single word, and multi-word
> cases, and make sure `node --test` is green.
