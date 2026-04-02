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

  it("returns 'untitled' for empty string", () => {
    assert.equal(slugify(""), "untitled");
  });

  it("returns 'untitled' for all-special-character title", () => {
    assert.equal(slugify("!@#$%^&*()"), "untitled");
  });

  it("hard-truncates single long word", () => {
    const result = slugify("supercalifragilisticexpialidocious", 10);
    assert.equal(result.length, 10);
    assert.equal(result, "supercalif");
  });

  it("strips path traversal characters", () => {
    assert.equal(slugify("../../etc/passwd"), "etcpasswd");
  });

  it("strips directory separators", () => {
    assert.equal(slugify("foo/bar/baz"), "foobarbaz");
  });

  it("strips backslash path separators", () => {
    assert.equal(slugify("foo\\bar\\baz"), "foobarbaz");
  });

  it("handles unicode by stripping non-ascii", () => {
    const result = slugify("Résumé des tâches");
    assert.ok(result.length > 0);
    assert.ok(!result.includes("é"));
    assert.ok(!result.includes("â"));
  });

  it("handles null byte injection", () => {
    const result = slugify("task\x00name");
    assert.ok(!result.includes("\x00"));
  });

  it("handles extremely long titles", () => {
    const long = "a".repeat(1000);
    const result = slugify(long, 60);
    assert.ok(result.length <= 60);
  });

  it("handles title with only numbers", () => {
    assert.equal(slugify("12345"), "12345");
  });

  it("handles title with only hyphens", () => {
    assert.equal(slugify("---"), "untitled");
  });

  it("handles mixed whitespace types", () => {
    assert.equal(slugify("tab\there\nnewline"), "tab-here-newline");
  });
});
