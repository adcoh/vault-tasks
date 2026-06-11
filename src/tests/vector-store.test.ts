import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../task.js";
import { VectorIndex } from "../search/vector-store.js";

function task(title: string, id = title): Task {
  return {
    id,
    title,
    status: "open",
    priority: "medium",
    tags: [],
    created: "2026-01-01",
    source: "",
    body: "",
    filePath: `/vault/${id}.md`,
    slug: id,
    extraMeta: {},
  };
}

describe("VectorIndex", () => {
  it("scores an identical direction at cosine 1", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 2, 3] }]);
    const hits = idx.query([2, 4, 6]); // same direction, different magnitude
    assert.equal(hits.length, 1);
    assert.ok(Math.abs(hits[0].score - 1) < 1e-9, `expected ~1, got ${hits[0].score}`);
    assert.equal(hits[0].mode, "semantic");
  });

  it("scores orthogonal vectors at cosine 0", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 0] }]);
    const hits = idx.query([0, 1]);
    assert.ok(Math.abs(hits[0].score) < 1e-9, `expected ~0, got ${hits[0].score}`);
  });

  it("ranks closer vectors above farther ones", () => {
    const idx = new VectorIndex([
      { task: task("near"), vector: [1, 0.1] },
      { task: task("far"), vector: [0, 1] },
    ]);
    const hits = idx.query([1, 0]);
    assert.equal(hits[0].task.title, "near");
    assert.equal(hits[1].task.title, "far");
    assert.ok(hits[0].score > hits[1].score);
  });

  it("returns [] for an empty corpus", () => {
    const idx = new VectorIndex([]);
    assert.deepEqual(idx.query([1, 2, 3]), []);
  });

  it("returns [] for a zero-magnitude query (no direction to compare)", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 1] }]);
    assert.deepEqual(idx.query([0, 0]), []);
  });

  it("handles a zero-magnitude document vector without dividing by zero", () => {
    const idx = new VectorIndex([
      { task: task("zero"), vector: [0, 0] },
      { task: task("real"), vector: [1, 0] },
    ]);
    const hits = idx.query([1, 0]);
    // The zero doc scores 0; the real doc scores 1 and ranks first.
    assert.equal(hits[0].task.title, "real");
    const zero = hits.find((h) => h.task.title === "zero");
    assert.ok(zero && Math.abs(zero.score) < 1e-9);
  });

  it("throws on a corpus with mismatched dimensions", () => {
    assert.throws(
      () =>
        new VectorIndex([
          { task: task("a"), vector: [1, 2, 3] },
          { task: task("b"), vector: [1, 2] },
        ]),
      /dimension mismatch/
    );
  });

  it("throws when the query dimension does not match the index", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 2, 3] }]);
    assert.throws(() => idx.query([1, 2]), /does not match index dimension/);
  });

  it("throws on a non-finite value in a corpus vector", () => {
    assert.throws(() => new VectorIndex([{ task: task("a"), vector: [1, NaN, 3] }]), /Non-finite/);
  });

  it("rejects a non-positive limit", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 0] }]);
    assert.throws(() => idx.query([1, 0], 0), /positive integer/);
  });

  it("rejects an unsafe-integer limit", () => {
    const idx = new VectorIndex([{ task: task("a"), vector: [1, 0] }]);
    assert.throws(() => idx.query([1, 0], 1e20), /positive integer/);
  });

  it("caps the result count at limit", () => {
    const idx = new VectorIndex([
      { task: task("a"), vector: [1, 0] },
      { task: task("b"), vector: [0.9, 0.1] },
      { task: task("c"), vector: [0.8, 0.2] },
    ]);
    assert.equal(idx.query([1, 0], 2).length, 2);
  });
});
