import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { similarity, similarityFromSets, trigramsOf } from "../similarity.js";

describe("similarity", () => {
  it("returns 1.0 for identical strings", () => {
    assert.equal(similarity("Fix auth bug", "Fix auth bug"), 1.0);
  });

  it("returns 1.0 for strings that normalize to the same value", () => {
    assert.equal(similarity("Fix Auth Bug!", "fix auth bug"), 1.0);
  });

  it("returns close to 0 for completely different strings", () => {
    const score = similarity("Fix auth bug", "Deploy infrastructure");
    assert.ok(score < 0.2, `Expected < 0.2 but got ${score}`);
  });

  it("scores high for word reordering", () => {
    const score = similarity("Fix auth bug", "auth bug fix");
    assert.ok(score > 0.7, `Expected > 0.7 for word reorder but got ${score}`);
  });

  it("scores high for similar titles with minor differences", () => {
    const score = similarity("Fix login redirect bug", "Fix the login redirect issue");
    assert.ok(score > 0.5, `Expected > 0.5 for similar titles but got ${score}`);
  });

  it("handles empty strings", () => {
    assert.equal(similarity("", ""), 1.0);
    assert.equal(similarity("something", ""), 0.0);
    assert.equal(similarity("", "something"), 0.0);
  });

  it("is case insensitive", () => {
    const a = similarity("FIX AUTH BUG", "fix auth bug");
    assert.equal(a, 1.0);
  });

  it("scores high despite punctuation differences", () => {
    const score = similarity("fix: auth-bug!", "fix auth bug");
    assert.ok(score > 0.7, `Expected > 0.7 despite punctuation but got ${score}`);
  });

  it("handles single-word titles", () => {
    const score = similarity("auth", "authentication");
    assert.ok(score > 0.3, `Expected > 0.3 for substring match but got ${score}`);
  });

  it("distinguishes clearly different tasks", () => {
    const score = similarity("Add user authentication", "Fix database migration");
    assert.ok(score < 0.3, `Expected < 0.3 for different tasks but got ${score}`);
  });

  it("detects near-duplicate task titles", () => {
    const score = similarity(
      "vault-tasks should check filesystem for ID collisions",
      "vt new should check filesystem for ID collisions before creating a task"
    );
    assert.ok(score > 0.6, `Expected > 0.6 for near-duplicate but got ${score}`);
  });

  it("handles diacritics by folding them to base letters", () => {
    // Previously "café" normalized to empty after stripping non-ASCII. Now
    // NFKD folding drops the combining acute so "café" and "cafe" compare as
    // identical words.
    assert.equal(similarity("café résumé", "cafe resume"), 1.0);
    const score = similarity("café résumé important", "Cafe Resume Important");
    assert.equal(score, 1.0);
  });

  it("preserves non-ASCII letters instead of discarding them", () => {
    // Two titles that share only the non-ASCII word must still have non-zero
    // similarity. Under the old ASCII-only normalize() both normalized to "".
    const score = similarity("über cool thing", "über not cool");
    assert.ok(score > 0.3, `Expected > 0.3 with shared über/cool, got ${score}`);
  });

  it("handles pure-emoji titles without throwing", () => {
    const score = similarity("🚀🚀🚀", "🎉🎉🎉");
    assert.ok(score >= 0 && score <= 1, `Expected valid score, got ${score}`);
  });

  it("scores zero for one-empty-one-nonempty after normalization", () => {
    // Title that normalizes to empty (pure punctuation) vs real content
    assert.equal(similarity("!!!", "Real task"), 0.0);
  });
});

describe("similarityFromSets / trigramsOf equivalence with similarity()", () => {
  const pairs: Array<[string, string]> = [
    ["Fix auth bug", "Fix auth bug"], // identical
    ["Fix auth bug", "Deploy infrastructure"], // disjoint
    ["Fix login redirect bug", "Fix the login redirect issue"], // partial overlap
    ["café résumé", "cafe resume"], // unicode/diacritics
    ["über cool thing", "über not cool"], // non-ASCII shared word
    ["", ""], // empty strings
    ["something", ""], // one empty
    ["", "something"], // other empty
    ["!!!", "???"], // punctuation-only, both normalize to ""
    ["!!!", "Real task"], // punctuation-only vs real content
    ["a", "a"], // single-char identical
    ["a", "b"], // single-char different
    ["fix: auth-bug!", "fix auth bug"], // punctuation differences
    ["line one\r\nline two", "line one\nline two"], // CRLF-ish whitespace
    ["🚀🚀🚀", "🎉🎉🎉"], // emoji
  ];

  for (const [a, b] of pairs) {
    it(`matches similarity() for ${JSON.stringify(a)} / ${JSON.stringify(b)}`, () => {
      const viaStrings = similarity(a, b);
      const viaSets = similarityFromSets(trigramsOf(a), trigramsOf(b));
      assert.equal(viaSets, viaStrings);
    });
  }

  it("gives 1.0 for two empty trigram sets (both punctuation-only)", () => {
    assert.equal(similarityFromSets(trigramsOf("!!!"), trigramsOf("???")), 1.0);
  });

  it("gives 0.0 when exactly one trigram set is empty", () => {
    assert.equal(similarityFromSets(trigramsOf("!!!"), trigramsOf("Real task")), 0.0);
  });

  it("trigramsOf produces a Set<string>", () => {
    const s = trigramsOf("Fix auth bug");
    assert.ok(s instanceof Set);
    assert.ok(s.size > 0);
  });

  it("computes an exact literal Dice coefficient for a mid-range pair", () => {
    // The pairs above are differential (new API vs old API) and would stay
    // green through a lockstep bug affecting both equally. Pin one absolute
    // value: 13 and 14 trigrams, 11 shared -> 22/27.
    assert.equal(
      similarityFromSets(trigramsOf("quartely plan"), trigramsOf("Quarterly Plan")),
      0.8148148148148148
    );
  });
});
