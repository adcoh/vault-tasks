import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { parseTaskIdFromFilename, TaskStore } from "../store.js";

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
      referenceDir: "references",
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

describe("TaskStore", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-test-"));
    store = new TaskStore(makeConfig(dir));
  });

  it("creates a task", () => {
    const task = store.create({ title: "Test task" });
    assert.equal(task.id, "0001");
    assert.equal(task.title, "Test task");
    assert.equal(task.status, "open");
    assert.equal(task.priority, "medium");
    assert.ok(existsSync(task.filePath));
  });

  it("creates tasks with incrementing IDs", () => {
    const t1 = store.create({ title: "First" });
    const t2 = store.create({ title: "Second" });
    assert.equal(t1.id, "0001");
    assert.equal(t2.id, "0002");
  });

  it("loads all tasks", () => {
    store.create({ title: "A" });
    store.create({ title: "B" });
    const tasks = store.loadAll();
    assert.equal(tasks.length, 2);
  });

  it("finds task by numeric ID", () => {
    store.create({ title: "Find me" });
    const found = store.find("1");
    assert.equal(found.title, "Find me");
  });

  it("finds task by substring", () => {
    store.create({ title: "Fix the login bug" });
    const found = store.find("login");
    assert.equal(found.title, "Fix the login bug");
  });

  it("throws on ambiguous match", () => {
    store.create({ title: "Fix login" });
    store.create({ title: "Fix login page" });
    assert.throws(() => store.find("login"), /Ambiguous/);
  });

  it("throws on no match", () => {
    store.create({ title: "Something" });
    assert.throws(() => store.find("nonexistent"), /No task matching/);
  });

  it("sets status to done and auto-archives", () => {
    store.create({ title: "To complete" });
    const updated = store.setStatus("1", "done");
    assert.equal(updated.status, "done");
    assert.ok(updated.filePath.includes("archive"));

    // Should not appear in normal loadAll
    const tasks = store.loadAll();
    assert.equal(tasks.length, 0);

    // Should appear with includeArchived
    const all = store.loadAll(true);
    assert.equal(all.length, 1);
  });

  it("searches by keyword", () => {
    store.create({ title: "Auth bug" });
    store.create({ title: "UI tweak" });
    const results = store.search("auth");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Auth bug");
  });

  it("counts tags", () => {
    store.create({ title: "A", tags: ["ui", "auth"] });
    store.create({ title: "B", tags: ["auth"] });
    const tags = store.allTags();
    assert.equal(tags.get("auth"), 2);
    assert.equal(tags.get("ui"), 1);
  });

  it("updates priority", () => {
    store.create({ title: "Low pri" });
    const updated = store.update("1", { priority: "high" });
    assert.equal(updated.priority, "high");

    // Verify it persisted
    const reloaded = store.find("1");
    assert.equal(reloaded.priority, "high");
  });

  it("preserves extra meta fields", () => {
    const task = store.create({ title: "With extra" });
    // Manually add an extra field to the file
    const content = readFileSync(task.filePath, "utf-8");
    // Insert extra field before the closing ---
    const modified = content.replace("\n---\n", "\ndue: 2026-04-15\n---\n");
    writeFileSync(task.filePath, modified);

    const reloaded = store.find("1");
    assert.equal(reloaded.extraMeta["due"], "2026-04-15");

    // Update and verify extra meta survives
    store.update("1", { priority: "high" });
    const afterUpdate = store.find("1");
    assert.equal(afterUpdate.extraMeta["due"], "2026-04-15");
  });

  it("rejects invalid priority", () => {
    assert.throws(() => store.create({ title: "Bad", priority: "urgent" }), /Invalid priority/);
  });

  it("rejects invalid status", () => {
    store.create({ title: "Test" });
    assert.throws(() => store.setStatus("1", "blocked"), /Invalid status/);
  });

  it("find shows descriptive error for archived tasks", () => {
    store.create({ title: "To archive" });
    store.setStatus("1", "done");
    assert.throws(() => store.find("1"), /archived/i);
  });

  it("update with status=done auto-archives", () => {
    store.create({ title: "Update archive" });
    const task = store.update("1", { status: "done" });
    assert.equal(task.status, "done");
    assert.ok(task.filePath.includes("archive"));
  });

  it("update with tags changes tags", () => {
    store.create({ title: "Tag me" });
    const task = store.update("1", { tags: ["new-tag", "other"] });
    assert.deepEqual(task.tags, ["new-tag", "other"]);
    // Verify persistence
    const reloaded = store.find("1");
    assert.deepEqual(reloaded.tags, ["new-tag", "other"]);
  });

  it("setStatus delegates to update", () => {
    store.create({ title: "Delegate test" });
    const task = store.setStatus("1", "in-progress");
    assert.equal(task.status, "in-progress");
  });

  it("archiveCompleted moves done and wont-do tasks", () => {
    const config = makeConfig(dir);
    config.autoArchive = false;
    const noAutoStore = new TaskStore(config);
    noAutoStore.create({ title: "Keep" });
    noAutoStore.create({ title: "Done one" });
    noAutoStore.create({ title: "Wont do" });
    noAutoStore.update("2", { status: "done" });
    noAutoStore.update("3", { status: "wont-do" });

    const archived = noAutoStore.archiveCompleted();
    assert.equal(archived.length, 2);

    const remaining = noAutoStore.loadAll();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].title, "Keep");
  });

  it("autoArchive=false does not move done tasks", () => {
    const config = makeConfig(dir);
    config.autoArchive = false;
    const noAutoStore = new TaskStore(config);
    noAutoStore.create({ title: "Stay here" });
    const task = noAutoStore.setStatus("1", "done");
    assert.ok(!task.filePath.includes("archive"));
    // Task should still be findable in backlog
    const found = noAutoStore.find("1");
    assert.equal(found.status, "done");
  });

  it("loadAll excludes non-task markdown files", () => {
    store.create({ title: "Real task" });
    // Create a non-task markdown file in backlog dir
    writeFileSync(join(dir, "backlog", "README.md"), "# Notes\n");
    const tasks = store.loadAll();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Real task");
  });

  it("search matches body content", () => {
    store.create({ title: "Generic title", body: "# Notes\nThe auth module needs fixing\n" });
    const results = store.search("auth");
    assert.equal(results.length, 1);
  });

  it("search with includeArchived finds archived tasks", () => {
    store.create({ title: "Searchable" });
    store.setStatus("1", "done");
    const results = store.search("searchable", true);
    assert.equal(results.length, 1);
  });

  it("archiveTask throws if destination exists", () => {
    store.create({ title: "First task" });
    store.create({ title: "Second task" });
    store.setStatus("1", "done");
    // Manually create a file at the archive destination for task 2
    mkdirSync(join(dir, "backlog", "archive"), { recursive: true });
    writeFileSync(join(dir, "backlog", "archive", "0002-second-task.md"), "conflicting");
    assert.throws(() => store.setStatus("2", "done"), /already exists/i);
  });

  it("loadAll returns tasks sorted by filename", () => {
    store.create({ title: "Second" });
    store.create({ title: "First" });
    const tasks = store.loadAll();
    assert.ok(tasks[0].id < tasks[1].id);
  });

  it("extraMeta cannot overwrite standard fields", () => {
    const task = store.create({ title: "Safe" });
    // Manually add extraMeta that tries to overwrite status
    const content = readFileSync(task.filePath, "utf-8");
    const modified = content.replace("\n---\n", "\ncustom_status: hacked\n---\n");
    writeFileSync(task.filePath, modified);

    // Update and verify status is not overwritten
    store.update("1", { priority: "high" });
    const reloaded = store.find("1");
    assert.equal(reloaded.status, "open");
    assert.equal(reloaded.extraMeta["custom_status"], "hacked");
  });

  it("ignores files with non-strict ID prefixes", () => {
    store.create({ title: "Real task" });
    // Filenames that look "task-like" but don't match strict ID formats
    // (alphanumeric prefix but not a canonical ULID or a numeric ID) must be
    // filtered out of listing, lookup, and dedupe.
    mkdirSync(join(dir, "backlog"), { recursive: true });
    writeFileSync(join(dir, "backlog", "notes-about-x.md"), "# notes\n");
    writeFileSync(join(dir, "backlog", "README.md"), "# readme\n");
    // ULID with illegal char (L) — should be rejected
    writeFileSync(
      join(dir, "backlog", "01ARZ3NDLKTSV4RRGSSFQ9XNHY-bad.md"),
      "---\ntitle: bad\n---\n"
    );

    const tasks = store.loadAll();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Real task");

    // find() must not surface any of the non-task files by substring either
    assert.throws(() => store.find("notes"), /No task matching/);
    assert.throws(() => store.find("README"), /No task matching/);
  });

  it("ambiguous-match error includes next-step guidance", () => {
    store.create({ title: "Fix login" });
    store.create({ title: "Fix login page" });
    try {
      store.find("login");
      assert.fail("expected an error");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /Ambiguous match/);
      assert.match(msg, /more characters|full filename/i);
    }
  });

  it("loadRecent caps results at limit, preferring newest", () => {
    for (let i = 0; i < 10; i++) {
      store.create({ title: `Task ${i}` });
    }
    const recent = store.loadRecent(3);
    assert.equal(recent.length, 3);
    // Sequential IDs: 0008, 0009, 0010 are newest
    assert.deepEqual(
      recent.map((t) => t.id).sort(),
      ["0008", "0009", "0010"]
    );
  });

  it("loadRecent with limit=0 returns all tasks", () => {
    store.create({ title: "A" });
    store.create({ title: "B" });
    const all = store.loadRecent(0);
    assert.equal(all.length, 2);
  });
});

describe("parseTaskIdFromFilename", () => {
  it("accepts canonical ULID filenames", () => {
    assert.equal(
      parseTaskIdFromFilename("01HYXABCDEFGHJKMNPQRSTVWXY-title.md"),
      "01HYXABCDEFGHJKMNPQRSTVWXY"
    );
  });

  it("accepts sequential filenames", () => {
    assert.equal(parseTaskIdFromFilename("0001-title.md"), "0001");
    assert.equal(parseTaskIdFromFilename("42-title.md"), "42");
  });

  it("accepts 14-digit timestamp filenames", () => {
    assert.equal(
      parseTaskIdFromFilename("20260413120000-title.md"),
      "20260413120000"
    );
  });

  it("rejects ULIDs containing excluded chars (I/L/O/U)", () => {
    // 26 chars but includes forbidden letters — must be rejected to keep
    // lookup/list behavior consistent with the ULID generator's strictness.
    assert.equal(
      parseTaskIdFromFilename("01ARZ3NDLKTSV4RRGSSFQ9XNHY-x.md"),
      null
    );
  });

  it("rejects non-task markdown filenames", () => {
    assert.equal(parseTaskIdFromFilename("notes-about-x.md"), null);
    assert.equal(parseTaskIdFromFilename("README.md"), null);
    assert.equal(parseTaskIdFromFilename("abc-def.md"), null);
    assert.equal(parseTaskIdFromFilename(".hidden.md"), null);
  });

  it("rejects non-.md files", () => {
    assert.equal(parseTaskIdFromFilename("0001-title.txt"), null);
    assert.equal(parseTaskIdFromFilename("0001-title"), null);
  });
});
