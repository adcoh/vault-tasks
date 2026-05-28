import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { TaskStore } from "../store.js";
import { searchTasks, similarTasks } from "../search/index.js";

function makeConfig(dir: string): Config {
  return {
    vaultRoot: dir,
    backlogDir: join(dir, "backlog"),
    archiveDir: join(dir, "backlog", "archive"),
    journalDir: join(dir, "journal"),
    projectsDir: join(dir, "projects"),
    evergreenDir: join(dir, "evergreen"),
    statuses: ["open", "in-progress", "done", "wont-do"],
    priorities: ["high", "medium", "low"],
    defaultPriority: "medium",
    defaultStatus: "open",
    archiveStatuses: ["done", "wont-do"],
    autoArchive: true,
    idStrategy: "sequential",
    padWidth: 4,
    slugMaxLength: 60,
    dedupeThreshold: 0.5,
    dedupeScanLimit: 500,
    project: { name: "", qualityCommand: "", testCommand: "", standardTags: [] },
    lint: {
      referenceDir: join(dir, "references"),
      referenceExclude: [],
      templateSourceDirs: [],
      templateSourceFiles: [],
      templatePatterns: [],
      skipDirs: [".git", "node_modules"],
      evergreenConventions: {
        requireFrontmatter: true,
        requireTitleField: true,
        requireTagsField: true,
        requireRelatedSection: true,
        requireBodyWikilink: true,
      },
      suggestionThreshold: 0.6,
    },
  };
}

describe("searchTasks", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-search-"));
    store = new TaskStore(makeConfig(dir));
  });

  it("returns an empty array for an empty corpus", async () => {
    const hits = await searchTasks(store, "anything", { mode: "bm25" });
    assert.deepEqual(hits, []);
  });

  it("returns BM25-ranked hits by default", async () => {
    // Use exact-word matches — BM25 has no stemming in v1, so "auth" only
    // matches docs that literally contain "auth" (not "authentication").
    store.create({ title: "Fix auth redirect bug" });
    store.create({ title: "Refactor database migration" });
    store.create({ title: "Auth callback handling" });
    const hits = await searchTasks(store, "auth", { mode: "bm25" });
    assert.ok(hits.length >= 2, `expected >= 2 hits, got ${hits.length}`);
    for (const h of hits) {
      assert.equal(h.mode, "bm25");
      assert.ok(h.score > 0);
    }
    assert.ok(!hits.find((h) => h.task.title.includes("database")),
      "unrelated task should not appear in BM25 results for 'auth'");
  });

  it("keyword mode falls back to substring matching with score 1.0", async () => {
    store.create({ title: "Fix auth bug" });
    store.create({ title: "UI tweak" });
    const hits = await searchTasks(store, "auth", { mode: "keyword" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mode, "keyword");
    assert.equal(hits[0].score, 1);
  });

  it("excludes archived tasks unless includeArchived is set", async () => {
    store.create({ title: "Active auth task" });
    store.create({ title: "Archived auth task" });
    store.setStatus("2", "done"); // auto-archives

    const active = await searchTasks(store, "auth", { mode: "bm25" });
    assert.ok(active.some((h) => h.task.title === "Active auth task"));
    assert.ok(!active.some((h) => h.task.title === "Archived auth task"));

    const all = await searchTasks(store, "auth", { mode: "bm25", includeArchived: true });
    assert.ok(all.some((h) => h.task.title === "Archived auth task"));
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 5; i++) {
      store.create({ title: `auth task ${i}` });
    }
    const hits = await searchTasks(store, "auth", { mode: "bm25", limit: 2 });
    assert.equal(hits.length, 2);
  });

  it("falls through to a clear error if mode is bypassed via a cast", async () => {
    // SearchMode is narrowed to 'keyword' | 'bm25' at compile time, so this
    // requires a deliberate cast. The runtime guards against future modes
    // being added to the type without a handler.
    store.create({ title: "Fix auth bug" });
    await assert.rejects(
      () => searchTasks(store, "auth", { mode: "semantic" as unknown as "bm25" }),
      /Unhandled search mode/
    );
  });

  it("rejects a non-positive limit", async () => {
    store.create({ title: "Fix auth bug" });
    await assert.rejects(
      () => searchTasks(store, "auth", { mode: "bm25", limit: 0 }),
      /positive integer/
    );
  });

  it("rejects unsafe-integer limits", async () => {
    store.create({ title: "Fix auth bug" });
    await assert.rejects(
      () => searchTasks(store, "auth", { mode: "bm25", limit: 1e20 }),
      /positive integer/
    );
  });

  it("library default mode is keyword (matches CLI)", async () => {
    store.create({ title: "Fix auth bug" });
    const hits = await searchTasks(store, "auth");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mode, "keyword");
  });

  it("keyword mode matches tags, not just title and body", async () => {
    store.create({ title: "Refactor module X", tags: ["backend"] });
    store.create({ title: "Unrelated UI fix", tags: ["frontend"] });
    const hits = await searchTasks(store, "backend", { mode: "keyword" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].task.title, "Refactor module X");
  });

  it("keyword mode results are priority-sorted", async () => {
    store.create({ title: "low auth", priority: "low" });
    store.create({ title: "high auth", priority: "high" });
    store.create({ title: "medium auth", priority: "medium" });
    const hits = await searchTasks(store, "auth", { mode: "keyword" });
    assert.equal(hits[0].task.title, "high auth");
    assert.equal(hits[1].task.title, "medium auth");
    assert.equal(hits[2].task.title, "low auth");
  });
});

describe("similarTasks", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-search-"));
    store = new TaskStore(makeConfig(dir));
  });

  it("excludes the target task from results", async () => {
    const target = store.create({ title: "Fix auth bug" });
    store.create({ title: "Fix auth callback handling" });
    const hits = await similarTasks(store, target, { mode: "bm25" });
    assert.ok(!hits.find((h) => h.task.filePath === target.filePath),
      "target task must be excluded from its own similarity results");
  });

  it("returns related tasks ranked by similarity", async () => {
    const target = store.create({ title: "Fix auth redirect bug", tags: ["auth"] });
    store.create({ title: "Fix auth callback handling", tags: ["auth"] });
    store.create({ title: "Refactor database migrations" });
    const hits = await similarTasks(store, target, { mode: "bm25" });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].task.title, "Fix auth callback handling");
  });

  it("returns [] when the corpus is empty after excluding the target", async () => {
    const target = store.create({ title: "Only task" });
    const hits = await similarTasks(store, target, { mode: "bm25" });
    assert.deepEqual(hits, []);
  });
});
