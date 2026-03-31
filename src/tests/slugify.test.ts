import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../slugify.js";

describe("slugify", () => {
  it("converts basic title", () => {
    assert.equal(slugify("Fix Authentication Bug"), "fix-authentication-bug");
  });

  it("strips special characters", () => {
    assert.equal(slugify("What's the deal?!"), "whats-the-deal");
  });

  it("collapses multiple spaces and hyphens", () => {
    assert.equal(slugify("too   many   spaces"), "too-many-spaces");
    assert.equal(slugify("too---many---hyphens"), "too-many-hyphens");
  });

  it("truncates at word boundary", () => {
    const long = "this is a very long title that should be truncated at a word boundary";
    const result = slugify(long, 30);
    assert.ok(result.length <= 30);
    assert.ok(!result.endsWith("-"));
  });

  it("handles max length exactly", () => {
    const result = slugify("short", 60);
    assert.equal(result, "short");
  });

  it("strips leading and trailing hyphens", () => {
    assert.equal(slugify("  -hello-  "), "hello");
  });
});
