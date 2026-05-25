import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../search/tokenize.js";

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    assert.deepEqual(tokenize("Fix Auth Bug"), ["fix", "auth", "bug"]);
  });

  it("splits on punctuation", () => {
    assert.deepEqual(tokenize("fix:auth-bug,now!"), ["fix", "auth", "bug", "now"]);
  });

  it("folds diacritics to base letters", () => {
    assert.deepEqual(tokenize("café résumé"), ["cafe", "resume"]);
  });

  it("preserves non-ASCII letters that have no diacritic", () => {
    const toks = tokenize("über cool");
    assert.deepEqual(toks, ["uber", "cool"]);
  });

  it("preserves digits inside tokens", () => {
    // Multi-char tokens kept; single-char fragments ("2" after splitting v1.2)
    // are filtered by the length-> 1 rule.
    assert.deepEqual(tokenize("issue 42 v1.2"), ["issue", "42", "v1"]);
  });

  it("drops single-character tokens", () => {
    // "I", "a" and the digit "5" all get filtered.
    assert.deepEqual(tokenize("I have 5 apples a day"), ["have", "apples", "day"]);
  });

  it("returns [] for empty or pure-punctuation input", () => {
    assert.deepEqual(tokenize(""), []);
    assert.deepEqual(tokenize("!!!"), []);
    assert.deepEqual(tokenize("---"), []);
  });

  it("normalizes CRLF and other whitespace", () => {
    assert.deepEqual(tokenize("foo\r\nbar\tbaz"), ["foo", "bar", "baz"]);
  });

  it("strips non-letter symbols without producing empty tokens", () => {
    assert.deepEqual(tokenize("hello, world! 🚀 done"), ["hello", "world", "done"]);
  });
});
