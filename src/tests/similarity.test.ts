import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { similarity } from "../similarity.js";

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
    const score = similarity(
      "Fix login redirect bug",
      "Fix the login redirect issue"
    );
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
    const score = similarity(
      "Add user authentication",
      "Fix database migration"
    );
    assert.ok(score < 0.3, `Expected < 0.3 for different tasks but got ${score}`);
  });

  it("detects near-duplicate task titles", () => {
    const score = similarity(
      "vault-tasks should check filesystem for ID collisions",
      "vt new should check filesystem for ID collisions before creating a task"
    );
    assert.ok(score > 0.6, `Expected > 0.6 for near-duplicate but got ${score}`);
  });
});
