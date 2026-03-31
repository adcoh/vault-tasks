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
});
