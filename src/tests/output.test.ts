import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortByPriority, formatTaskTable, formatStaleTable, formatTagList } from "../output.js";
import type { Task } from "../task.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "0001",
    title: "Test task",
    status: "open",
    priority: "medium",
    tags: [],
    created: "2026-03-01",
    source: "",
    body: "",
    filePath: "/tmp/0001-test.md",
    slug: "0001-test",
    extraMeta: {},
    ...overrides,
  };
}

describe("sortByPriority", () => {
  it("sorts high before medium before low", () => {
    const tasks = [
      makeTask({ priority: "low", title: "Low" }),
      makeTask({ priority: "high", title: "High" }),
      makeTask({ priority: "medium", title: "Med" }),
    ];
    const sorted = sortByPriority(tasks);
    assert.equal(sorted[0].title, "High");
    assert.equal(sorted[1].title, "Med");
    assert.equal(sorted[2].title, "Low");
  });

  it("breaks ties by created date", () => {
    const tasks = [
      makeTask({ priority: "high", created: "2026-03-15", title: "Later" }),
      makeTask({ priority: "high", created: "2026-03-01", title: "Earlier" }),
    ];
    const sorted = sortByPriority(tasks);
    assert.equal(sorted[0].title, "Earlier");
    assert.equal(sorted[1].title, "Later");
  });

  it("handles unknown priority values", () => {
    const tasks = [
      makeTask({ priority: "high", title: "Known" }),
      makeTask({ priority: "critical", title: "Unknown" }),
    ];
    const sorted = sortByPriority(tasks);
    assert.equal(sorted[0].title, "Known");
    assert.equal(sorted[1].title, "Unknown");
  });

  it("does not mutate original array", () => {
    const tasks = [
      makeTask({ priority: "low" }),
      makeTask({ priority: "high" }),
    ];
    const original = [...tasks];
    sortByPriority(tasks);
    assert.equal(tasks[0].priority, original[0].priority);
  });
});

describe("formatTaskTable", () => {
  it("returns 'No tasks found.' for empty array", () => {
    assert.equal(formatTaskTable([]), "No tasks found.");
  });

  it("includes header, divider, and task rows", () => {
    const tasks = [makeTask({ id: "0001", title: "Test", status: "open", priority: "high" })];
    const result = formatTaskTable(tasks);
    const lines = result.split("\n");
    assert.ok(lines[0].includes("ID"));
    assert.ok(lines[0].includes("STATUS"));
    assert.ok(lines[1].startsWith("---"));
    assert.ok(lines[2].includes("Test"));
  });

  it("handles missing created date", () => {
    const tasks = [makeTask({ created: "" })];
    const result = formatTaskTable(tasks);
    assert.ok(result.includes("?"));
  });
});

describe("formatStaleTable", () => {
  it("returns 'No stale tasks found.' for empty array", () => {
    assert.equal(formatStaleTable([]), "No stale tasks found.");
  });

  it("includes header and task rows", () => {
    const items = [{ task: makeTask({ id: "0042", title: "Old task" }), ageDays: 30 }];
    const result = formatStaleTable(items);
    assert.ok(result.includes("42"));
    assert.ok(result.includes("30"));
    assert.ok(result.includes("Old task"));
  });
});

describe("formatTagList", () => {
  it("returns 'No tags found.' for empty map", () => {
    assert.equal(formatTagList(new Map()), "No tags found.");
  });

  it("sorts tags alphabetically", () => {
    const tags = new Map([["zebra", 1], ["alpha", 2]]);
    const result = formatTagList(tags);
    const lines = result.split("\n");
    assert.ok(lines[0].includes("alpha"));
    assert.ok(lines[1].includes("zebra"));
  });

  it("shows counts", () => {
    const tags = new Map([["auth", 3]]);
    const result = formatTagList(tags);
    assert.ok(result.includes("auth (3)"));
  });
});
