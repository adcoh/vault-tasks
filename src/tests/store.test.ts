import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

function makeConfig(dir: string): Config {
  return {
    vaultRoot: dir,
    backlogDir: join(dir, "50-backlog"),
    archiveDir: join(dir, "50-backlog", "archive"),
    statuses: ["open", "in-progress", "done", "wont-do"],
    priorities: ["high", "medium", "low"],
    defaultPriority: "medium",
    defaultStatus: "open",
    archiveStatuses: ["done", "wont-do"],
    autoArchive: true,
    idStrategy: "sequential",
    padWidth: 4,
    slugMaxLength: 60,
    project: { name: "", qualityCommand: "", testCommand: "", standardTags: [] },
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
    assert.equal(task.id, 1);
    assert.equal(task.title, "Test task");
    assert.equal(task.status, "open");
    assert.equal(task.priority, "medium");
    assert.ok(existsSync(task.filePath));
  });

  it("creates tasks with incrementing IDs", () => {
    const t1 = store.create({ title: "First" });
    const t2 = store.create({ title: "Second" });
    assert.equal(t1.id, 1);
    assert.equal(t2.id, 2);
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
    writeFileSync(join(dir, "50-backlog", "README.md"), "# Notes\n");
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
    mkdirSync(join(dir, "50-backlog", "archive"), { recursive: true });
    writeFileSync(join(dir, "50-backlog", "archive", "0002-second-task.md"), "conflicting");
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
});
