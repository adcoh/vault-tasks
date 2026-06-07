import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "../task.js";
import type { Embedder } from "../search/embeddings.js";
import { EmbedCache } from "../search/embed-cache.js";

function task(id: string, title: string, body = ""): Task {
  return {
    id,
    title,
    status: "open",
    priority: "medium",
    tags: [],
    created: "2026-01-01",
    source: "",
    body,
    filePath: `/vault/${id}.md`,
    slug: id,
    extraMeta: {},
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic embedder that records the texts it was asked to embed. */
function trackingEmbedder(
  model = "m",
  provider: Embedder["provider"] = "ollama"
): { embedder: Embedder; calls: string[][] } {
  const calls: string[][] = [];
  const embedder: Embedder = {
    provider,
    model,
    async embed(texts: string[]): Promise<number[][]> {
      calls.push([...texts]);
      return texts.map((t) => [t.length, hash(t) % 97, (hash(t) >> 3) % 89, 1]);
    },
  };
  return { embedder, calls };
}

const CACHE_FILE = join(".vault-tasks", "embeddings.json");

describe("EmbedCache", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-embcache-"));
  });

  it("computes on first call and persists a cache file", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    const out = await cache.getOrCompute([task("1", "alpha")], embedder);

    assert.equal(out.length, 1);
    assert.equal(out[0].vector.length, 4);
    assert.equal(calls.length, 1, "embedder should be called once");
    assert.ok(existsSync(join(dir, CACHE_FILE)), "cache file should be written");
  });

  it("serves a second identical call from disk without re-embedding", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    const tasks = [task("1", "alpha")];
    await cache.getOrCompute(tasks, embedder);
    await cache.getOrCompute(tasks, embedder);
    assert.equal(calls.length, 1, "second call must be a pure cache hit");
  });

  it("embeds only the misses on an incremental call", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    await cache.getOrCompute([task("1", "alpha")], embedder);
    await cache.getOrCompute([task("1", "alpha"), task("2", "beta")], embedder);
    assert.equal(calls.length, 2);
    // The second batch must contain only the new task's text.
    assert.equal(calls[1].length, 1);
    assert.ok(calls[1][0].includes("beta"));
  });

  it("re-embeds when a task's content changes", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    await cache.getOrCompute([task("1", "alpha", "v1")], embedder);
    await cache.getOrCompute([task("1", "alpha", "v2 body changed")], embedder);
    assert.equal(calls.length, 2, "changed content is a cache miss");
  });

  it("invalidates the whole cache when the model changes", async () => {
    const first = trackingEmbedder("model-a");
    await new EmbedCache(dir, "ollama", "model-a").getOrCompute([task("1", "alpha")], first.embedder);

    const second = trackingEmbedder("model-b");
    await new EmbedCache(dir, "ollama", "model-b").getOrCompute([task("1", "alpha")], second.embedder);
    assert.equal(second.calls.length, 1, "a different model must not reuse cached vectors");
  });

  it("invalidates the whole cache when the provider changes", async () => {
    const first = trackingEmbedder("m", "ollama");
    await new EmbedCache(dir, "ollama", "m").getOrCompute([task("1", "alpha")], first.embedder);

    const second = trackingEmbedder("m", "openai");
    await new EmbedCache(dir, "openai", "m").getOrCompute([task("1", "alpha")], second.embedder);
    assert.equal(second.calls.length, 1, "a different provider must not reuse cached vectors");
  });

  it("rebuilds from scratch when the cache file is not valid JSON", async () => {
    // Pre-create the cache file with garbage.
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    await cache.getOrCompute([task("1", "alpha")], embedder); // creates the dir + file
    writeFileSync(join(dir, CACHE_FILE), "{ this is not json", "utf-8");

    const out = await cache.getOrCompute([task("1", "alpha")], embedder);
    assert.equal(out.length, 1);
    assert.equal(out[0].vector.length, 4);
    assert.equal(calls.length, 2, "corrupt JSON forces a recompute");
  });

  it("rejects a cached entry with non-finite values and recomputes (no unsafe cast)", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    await cache.getOrCompute([task("1", "alpha")], embedder);

    // Corrupt the stored vector: JSON cannot hold NaN, so simulate with nulls.
    const file = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    for (const key of Object.keys(file.entries)) {
      file.entries[key] = [null, null, null, null];
    }
    writeFileSync(join(dir, CACHE_FILE), JSON.stringify(file), "utf-8");

    await cache.getOrCompute([task("1", "alpha")], embedder);
    assert.equal(calls.length, 2, "an invalid stored vector must be treated as a miss");
  });

  it("records the vector dimension in the cache header", async () => {
    const { embedder } = trackingEmbedder();
    await new EmbedCache(dir, "ollama", "m").getOrCompute([task("1", "alpha")], embedder);
    const file = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    assert.equal(file.dimensions, 4);
    assert.equal(file.provider, "ollama");
    assert.equal(file.model, "m");
  });

  it("prunes entries for deleted tasks on the next write", async () => {
    const { embedder } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    await cache.getOrCompute([task("1", "alpha"), task("2", "beta")], embedder);
    let file = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    assert.equal(Object.keys(file.entries).length, 2);

    // Drop task 2, add task 3 — the write must prune the stale entry.
    await cache.getOrCompute([task("1", "alpha"), task("3", "gamma")], embedder);
    file = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    assert.equal(Object.keys(file.entries).length, 2, "deleted task entry should be pruned");
  });

  it("returns [] for an empty task list without touching disk", async () => {
    const { embedder, calls } = trackingEmbedder();
    const cache = new EmbedCache(dir, "ollama", "m");
    const out = await cache.getOrCompute([], embedder);
    assert.deepEqual(out, []);
    assert.equal(calls.length, 0);
    assert.ok(!existsSync(join(dir, CACHE_FILE)));
  });
});
