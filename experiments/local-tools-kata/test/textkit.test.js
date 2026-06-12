import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, truncate, wordCount } from "../src/textkit.js";

test("slugify lowercases and hyphenates", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify drops punctuation", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("slugify collapses spaces and trims edges", () => {
  assert.equal(slugify("  The   Quick  Brown  "), "the-quick-brown");
});

test("slugify keeps digits", () => {
  assert.equal(slugify("Top 10 Tips"), "top-10-tips");
});

test("truncate leaves short strings alone", () => {
  assert.equal(truncate("hello", 8), "hello");
});

test("truncate cuts and appends an ellipsis to exact length", () => {
  const out = truncate("hello world", 8);
  assert.equal(out, "hello w…");
  assert.equal(out.length, 8);
});

test("truncate handles a longer cut", () => {
  assert.equal(truncate("abcdefghij", 4), "abc…");
});

test("wordCount counts plain words", () => {
  assert.equal(wordCount("a b c"), 3);
});

test("wordCount ignores leading/trailing/duplicate whitespace", () => {
  assert.equal(wordCount("  a  b   c "), 3);
});

test("wordCount of empty or blank string is 0", () => {
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("   "), 0);
});
