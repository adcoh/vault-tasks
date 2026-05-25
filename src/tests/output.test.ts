import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortByPriority, formatTaskTable, formatStaleTable, formatTagList, formatSearchHits, sanitizeForDisplay } from "../output.js";
import type { Task } from "../task.js";
import type { SearchHit } from "../search/types.js";

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

describe("formatSearchHits", () => {
  it("returns 'No matching tasks.' for empty array", () => {
    assert.equal(formatSearchHits([]), "No matching tasks.");
  });

  it("includes a SCORE column", () => {
    const hit: SearchHit = { task: makeTask(), score: 3.14, mode: "bm25" };
    const result = formatSearchHits([hit]);
    const lines = result.split("\n");
    assert.ok(lines[0].includes("SCORE"));
    // Score should appear rounded to 2 decimals.
    assert.ok(lines[2].includes("3.14"), `expected formatted score in row, got: ${lines[2]}`);
  });

  it("preserves task ordering from the input array (caller-ranked)", () => {
    // formatSearchHits is a pure formatter — ranking happens upstream.
    const hits: SearchHit[] = [
      { task: makeTask({ id: "0001", title: "First" }), score: 1.0, mode: "bm25" },
      { task: makeTask({ id: "0002", title: "Second" }), score: 5.0, mode: "bm25" },
    ];
    const lines = formatSearchHits(hits).split("\n");
    const firstIdx = lines.findIndex((l) => l.includes("First"));
    const secondIdx = lines.findIndex((l) => l.includes("Second"));
    assert.ok(firstIdx < secondIdx, "input order must be preserved");
  });

  it("does not crash when status equals a prototype-chain property name", () => {
    // Hostile YAML: status: constructor / toString / __proto__ / hasOwnProperty.
    // Without the Object.hasOwn guard, STATUS_DISPLAY[s] returns inherited
    // functions/objects → .padEnd throws TypeError → every list/search crashes.
    for (const status of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const hit: SearchHit = { task: makeTask({ status }), score: 1, mode: "bm25" };
      assert.doesNotThrow(() => formatSearchHits([hit]));
    }
  });

  it("strips ANSI escape sequences from rendered titles", () => {
    const hit: SearchHit = {
      task: makeTask({ title: "\x1b[31mInjected\x1b[0m" }),
      score: 1.0,
      mode: "bm25",
    };
    const result = formatSearchHits([hit]);
    assert.ok(!result.includes("\x1b"), `escape sequence must be stripped: ${JSON.stringify(result)}`);
    assert.ok(result.includes("Injected"));
  });

  it("collapses newlines and tabs in titles into single spaces", () => {
    const hit: SearchHit = {
      task: makeTask({ title: "real\n0099 99.99   open      hi  FORGED ROW" }),
      score: 1.0,
      mode: "bm25",
    };
    const result = formatSearchHits([hit]);
    // The output is header + divider + one row — no forged row.
    const taskRows = result.split("\n").filter((l) => /^\S/.test(l)).slice(2);
    assert.equal(taskRows.length, 1);
    assert.ok(!result.includes("\n0099"));
  });
});

describe("sanitizeForDisplay", () => {
  it("strips C0 and C1 control characters", () => {
    assert.equal(sanitizeForDisplay("\x1b[31mfoo\x1b[0m"), "[31mfoo[0m");
    assert.equal(sanitizeForDisplay("\x00\x01\x02bar"), "bar");
  });
  it("collapses \\n, \\r, \\t into single spaces", () => {
    assert.equal(sanitizeForDisplay("a\nb"), "a b");
    assert.equal(sanitizeForDisplay("a\r\nb"), "a  b");
    assert.equal(sanitizeForDisplay("a\tb"), "a b");
  });
  it("leaves normal text untouched", () => {
    assert.equal(sanitizeForDisplay("Hello, world! 🚀"), "Hello, world! 🚀");
  });
});
