import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
});
