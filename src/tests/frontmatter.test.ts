import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, writeFrontmatter } from "../frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses basic key-value pairs", () => {
    const text = `---
title: My Task
status: open
priority: high
created: 2026-03-31
---
# My Task
`;
    const { meta, body } = parseFrontmatter(text);
    assert.equal(meta["title"], "My Task");
    assert.equal(meta["status"], "open");
    assert.equal(meta["priority"], "high");
    assert.equal(meta["created"], "2026-03-31");
    assert.equal(body, "# My Task\n");
  });

  it("parses inline array tags", () => {
    const text = `---
tags: [auth, security]
---
Body`;
    const { meta } = parseFrontmatter(text);
    assert.deepEqual(meta["tags"], ["auth", "security"]);
  });

  it("parses block-style array tags", () => {
    const text = `---
tags:
  - auth
  - security
---
Body`;
    const { meta } = parseFrontmatter(text);
    assert.deepEqual(meta["tags"], ["auth", "security"]);
  });

  it("handles quoted values", () => {
    const text = `---
source: "[[2026-03-31]]"
---
Body`;
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["source"], "[[2026-03-31]]");
  });

  it("returns empty meta for no frontmatter", () => {
    const text = "Just a body";
    const { meta, body } = parseFrontmatter(text);
    assert.deepEqual(meta, {});
    assert.equal(body, "Just a body");
  });

  it("preserves body with --- in it", () => {
    const text = `---
title: Test
---
Some text
---
More text`;
    const { meta, body } = parseFrontmatter(text);
    assert.equal(meta["title"], "Test");
    assert.ok(body.includes("More text"));
  });

  it("handles value containing colon", () => {
    const text = "---\ntitle: \"Fix: the login bug\"\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["title"], "Fix: the login bug");
  });

  it("handles value containing --- in frontmatter", () => {
    const text = "---\ntitle: \"Phase 1 --- Phase 2\"\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["title"], "Phase 1 --- Phase 2");
  });

  it("handles empty frontmatter block", () => {
    const text = "---\n---\nBody";
    const { meta, body } = parseFrontmatter(text);
    assert.deepEqual(meta, {});
    assert.equal(body, "Body");
  });

  it("handles CRLF line endings", () => {
    const text = "---\r\ntitle: Test\r\nstatus: open\r\n---\r\nBody";
    const { meta, body } = parseFrontmatter(text);
    assert.equal(meta["title"], "Test");
    assert.equal(meta["status"], "open");
    assert.equal(body, "Body");
  });

  it("parses keys with dots", () => {
    const text = "---\nobsidian.cssclass: wide\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["obsidian.cssclass"], "wide");
  });

  it("handles empty array []", () => {
    const text = "---\ntags: []\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.deepEqual(meta["tags"], []);
  });

  it("handles duplicate keys (last wins)", () => {
    const text = "---\ntitle: First\ntitle: Second\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["title"], "Second");
  });

  it("unescapes double-quoted values", () => {
    const text = '---\ntitle: "Say \\"hello\\""\n---\nBody';
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["title"], 'Say "hello"');
  });

  it("handles single-quoted values", () => {
    const text = "---\ntitle: 'Don''t stop'\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["title"], "Don't stop");
  });

  it("handles wikilink value without treating as array", () => {
    const text = "---\nsource: [[2026-03-31]]\n---\nBody";
    const { meta } = parseFrontmatter(text);
    assert.equal(meta["source"], "[[2026-03-31]]");
  });

  it("handles no closing delimiter", () => {
    const text = "---\ntitle: Test\nNo closing";
    const { meta, body } = parseFrontmatter(text);
    assert.deepEqual(meta, {});
    assert.equal(body, text);
  });

  it("handles --- with trailing whitespace as delimiter", () => {
    const text = "---\ntitle: Test\n---   \nBody";
    const { meta, body } = parseFrontmatter(text);
    assert.equal(meta["title"], "Test");
    assert.equal(body, "Body");
  });

  it("strips quotes from inline array items", () => {
    const text = '---\ntags: ["auth", "security"]\n---\nBody';
    const { meta } = parseFrontmatter(text);
    assert.deepEqual(meta["tags"], ["auth", "security"]);
  });

  it("strips quotes from block list items", () => {
    const text = '---\ntags:\n  - "auth"\n  - "security"\n---\nBody';
    const { meta } = parseFrontmatter(text);
    assert.deepEqual(meta["tags"], ["auth", "security"]);
  });
});

describe("writeFrontmatter", () => {
  it("writes basic frontmatter", () => {
    const meta = { title: "Test", status: "open" };
    const result = writeFrontmatter(meta, "# Test\n");
    assert.ok(result.startsWith("---\n"));
    assert.ok(result.includes("title: Test"));
    assert.ok(result.includes("status: open"));
    assert.ok(result.endsWith("# Test\n"));
  });

  it("writes array values as block lists", () => {
    const meta = { tags: ["a", "b"] };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes("tags:\n  - a\n  - b"));
  });

  it("round-trips correctly", () => {
    const original = `---
title: Round Trip
status: open
tags:
  - one
  - two
---
# Body\n`;
    const { meta, body } = parseFrontmatter(original);
    const result = writeFrontmatter(meta, body);
    const { meta: meta2, body: body2 } = parseFrontmatter(result);
    assert.equal(meta2["title"], meta["title"]);
    assert.deepEqual(meta2["tags"], meta["tags"]);
    assert.equal(body2, body);
  });

  it("quotes values with colons", () => {
    const meta = { title: "Fix: the bug" };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes('title: "Fix: the bug"'));
  });

  it("quotes values with special YAML characters", () => {
    const meta = { source: "[[2026-03-31]]" };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes('source: "[[2026-03-31]]"'));
  });

  it("skips null and undefined values", () => {
    const meta: Record<string, unknown> = { title: "Test", empty: null, missing: undefined };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes("title: Test"));
    assert.ok(!result.includes("empty"));
    assert.ok(!result.includes("missing"));
  });

  it("writes empty arrays as []", () => {
    const meta = { tags: [] };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes("tags: []"));
  });

  it("round-trips empty arrays", () => {
    const meta = { tags: [] as string[] };
    const written = writeFrontmatter(meta, "Body");
    const { meta: parsed } = parseFrontmatter(written);
    assert.deepEqual(parsed["tags"], []);
  });

  it("round-trips values with colons", () => {
    const meta = { title: "Fix: the bug", status: "open" };
    const written = writeFrontmatter(meta, "Body");
    const { meta: parsed } = parseFrontmatter(written);
    assert.equal(parsed["title"], "Fix: the bug");
    assert.equal(parsed["status"], "open");
  });

  it("round-trips values with special characters", () => {
    const meta = { source: "https://example.com/path?q=1#section" };
    const written = writeFrontmatter(meta, "Body");
    const { meta: parsed } = parseFrontmatter(written);
    assert.equal(parsed["source"], "https://example.com/path?q=1#section");
  });

  it("quotes YAML boolean literals to keep them as strings", () => {
    const meta = { status: "true" };
    const result = writeFrontmatter(meta, "Body");
    assert.ok(result.includes('status: "true"'));
    const { meta: parsed } = parseFrontmatter(result);
    assert.equal(parsed["status"], "true");
  });

  it("round-trips wikilinks in arrays", () => {
    const meta = { sources: ["[[note1]]", "[[note2]]"] };
    const written = writeFrontmatter(meta, "Body");
    const { meta: parsed } = parseFrontmatter(written);
    assert.deepEqual(parsed["sources"], ["[[note1]]", "[[note2]]"]);
  });

  it("round-trips a ULID-shaped id string without numeric coercion", () => {
    // ULIDs are all-uppercase Crockford base32; they must round-trip as a
    // plain string, not be coerced to a number or YAML-quoted unnecessarily.
    const ulid = "01HYXABCDEFGHJKMNPQRSTVWXY";
    const { meta: parsed } = parseFrontmatter(
      writeFrontmatter({ id: ulid, title: "t" }, "body")
    );
    assert.equal(parsed["id"], ulid);
    assert.equal(typeof parsed["id"], "string");
  });

  it("round-trips a purely-numeric id string without becoming a number", () => {
    // A numeric task ID like "42" must survive write/parse as a string so
    // callers comparing `task.id === "42"` still succeed.
    const { meta: parsed } = parseFrontmatter(
      writeFrontmatter({ id: "42", title: "t" }, "body")
    );
    assert.equal(parsed["id"], "42");
    assert.equal(typeof parsed["id"], "string");
  });
});
