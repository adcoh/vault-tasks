import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BM25Index } from "../search/bm25.js";
import type { Task } from "../task.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "0000",
    title: overrides.title ?? "",
    status: "open",
    priority: "medium",
    tags: overrides.tags ?? [],
    created: "2026-01-01",
    source: "",
    body: overrides.body ?? "",
    filePath: overrides.filePath ?? `/tmp/${overrides.id ?? "0000"}.md`,
    slug: overrides.id ?? "0000",
    extraMeta: {},
  };
}

describe("BM25Index", () => {
  it("returns an empty result for an empty corpus", () => {
    const idx = new BM25Index([]);
    assert.deepEqual(idx.query("anything", 5), []);
  });

  it("returns an empty result for an empty query", () => {
    const idx = new BM25Index([task({ id: "0001", title: "Fix auth bug" })]);
    assert.deepEqual(idx.query("", 5), []);
    assert.deepEqual(idx.query("   ", 5), []);
  });

  it("ranks the exact title above weaker matches", () => {
    const corpus = [
      task({ id: "0001", title: "Fix auth bug", body: "" }),
      task({ id: "0002", title: "Refactor database migrations", body: "" }),
      task({ id: "0003", title: "Add user notifications", body: "" }),
    ];
    const idx = new BM25Index(corpus);
    const hits = idx.query("auth bug", 5);
    assert.ok(hits.length > 0);
    assert.equal(hits[0].task.id, "0001");
    assert.ok(hits[0].score > 0);
  });

  it("returns no hits when no query token matches any document", () => {
    const corpus = [task({ id: "0001", title: "Fix auth bug" })];
    const idx = new BM25Index(corpus);
    assert.deepEqual(idx.query("kubernetes", 5), []);
  });

  it("weights title higher than body via title-doubling", () => {
    // Doc A has the term in its title once; doc B has the term in its body
    // once. Title-doubling means A should outrank B.
    const a = task({ id: "0001", title: "auth refactor", body: "unrelated text" });
    const b = task({ id: "0002", title: "unrelated", body: "auth in the body only" });
    const idx = new BM25Index([a, b]);
    const hits = idx.query("auth", 5);
    assert.equal(hits[0].task.id, "0001");
    assert.equal(hits[1].task.id, "0002");
  });

  it("indexes tags as part of the document", () => {
    const corpus = [
      task({ id: "0001", title: "Generic task", tags: ["security", "backend"] }),
      task({ id: "0002", title: "Generic task", tags: ["docs"] }),
    ];
    const idx = new BM25Index(corpus);
    const hits = idx.query("security", 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].task.id, "0001");
  });

  it("scores rarer terms higher (IDF monotonicity)", () => {
    // 'common' appears in many docs, 'rare' appears in one. The doc that
    // matches the rare term alone should outscore the doc that matches the
    // common term alone.
    const corpus = [
      task({ id: "0001", title: "common common common common rare" }),
      task({ id: "0002", title: "common task" }),
      task({ id: "0003", title: "common stuff" }),
      task({ id: "0004", title: "common things" }),
      task({ id: "0005", title: "common entries" }),
    ];
    const idx = new BM25Index(corpus);
    const rareHits = idx.query("rare", 5);
    const commonHits = idx.query("common", 5);
    assert.equal(rareHits.length, 1);
    assert.ok(rareHits[0].score > commonHits[0].score,
      `rare-term score (${rareHits[0].score}) should exceed common-term top (${commonHits[0].score})`);
  });

  it("saturates term frequency (k1 bound)", () => {
    // BM25's TF saturation: adding a 4th occurrence yields less score than
    // adding the 2nd occurrence. We verify by comparing single-term scores on
    // documents that differ only in how often the query term appears.
    const lowReps = task({ id: "0001", title: "auth", body: "auth" });          // 2 occurrences (title doubled)
    const highReps = task({ id: "0002", title: "auth", body: "auth auth auth auth auth auth auth auth" });
    const idx = new BM25Index([lowReps, highReps]);
    const hits = idx.query("auth", 5);
    const lowScore = hits.find((h) => h.task.id === "0001")!.score;
    const highScore = hits.find((h) => h.task.id === "0002")!.score;
    // High-reps must score higher (more matches) ...
    assert.ok(highScore > lowScore);
    // ... but not 4x higher (TF saturation), even though it has ~5x more occurrences.
    assert.ok(highScore < lowScore * 4,
      `TF should saturate: highScore=${highScore} not ~5x lowScore=${lowScore}`);
  });

  it("respects the limit parameter", () => {
    const corpus = Array.from({ length: 10 }, (_, i) =>
      task({ id: String(i + 1).padStart(4, "0"), title: `task ${i} auth` })
    );
    const idx = new BM25Index(corpus);
    const hits = idx.query("auth", 3);
    assert.equal(hits.length, 3);
  });

  it("rejects non-positive limit", () => {
    const idx = new BM25Index([task({ id: "0001", title: "auth" })]);
    assert.throws(() => idx.query("auth", 0), /positive integer/);
    assert.throws(() => idx.query("auth", -1), /positive integer/);
    assert.throws(() => idx.query("auth", 1.5), /positive integer/);
  });

  it("tags each hit with mode 'bm25'", () => {
    const idx = new BM25Index([task({ id: "0001", title: "auth bug" })]);
    const [hit] = idx.query("auth", 5);
    assert.equal(hit.mode, "bm25");
  });

  it("queryTokens accepts pre-tokenized input", () => {
    const idx = new BM25Index([task({ id: "0001", title: "auth bug" })]);
    const hits = idx.queryTokens(["auth"], 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].task.id, "0001");
  });

  it("size reflects the document count", () => {
    const idx = new BM25Index([
      task({ id: "0001", title: "a" }),
      task({ id: "0002", title: "b" }),
    ]);
    assert.equal(idx.size, 2);
  });
});
