import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { getNextId, formatId } from "../counter.js";

function makeConfig(dir: string, strategy: Config["idStrategy"] = "sequential"): Config {
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
    idStrategy: strategy,
    padWidth: 4,
    slugMaxLength: 60,
    project: { name: "", qualityCommand: "", testCommand: "", standardTags: [] },
  };
}

describe("getNextId", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-counter-"));
    mkdirSync(join(dir, "backlog"), { recursive: true });
  });

  it("returns 1 for empty directory (sequential)", () => {
    const config = makeConfig(dir, "sequential");
    const id = getNextId(config);
    assert.equal(id, 1);
  });

  it("returns max+1 when files exist (sequential)", () => {
    const config = makeConfig(dir, "sequential");
    writeFileSync(join(dir, "backlog", "0003-task.md"), "");
    writeFileSync(join(dir, "backlog", "0001-task.md"), "");
    const id = getNextId(config);
    assert.equal(id, 4);
  });

  it("scans archive directory too (sequential)", () => {
    const config = makeConfig(dir, "sequential");
    mkdirSync(join(dir, "backlog", "archive"), { recursive: true });
    writeFileSync(join(dir, "backlog", "0001-task.md"), "");
    writeFileSync(join(dir, "backlog", "archive", "0005-old.md"), "");
    const id = getNextId(config);
    assert.equal(id, 6);
  });

  it("ignores non-md files", () => {
    const config = makeConfig(dir, "sequential");
    writeFileSync(join(dir, "backlog", "0010-readme.txt"), "");
    writeFileSync(join(dir, "backlog", "0002-task.md"), "");
    const id = getNextId(config);
    assert.equal(id, 3);
  });

  it("returns a numeric ID (timestamp strategy)", () => {
    const config = makeConfig(dir, "timestamp");
    const id = getNextId(config);
    assert.equal(typeof id, "number");
    assert.ok(id > 20000000000000, "timestamp ID should be 14 digits");
    assert.ok(Number.isSafeInteger(id), "ID must be a safe integer");
  });

  it("returns a numeric ID (ulid strategy)", () => {
    const config = makeConfig(dir, "ulid");
    const id = getNextId(config);
    assert.equal(typeof id, "number");
    assert.ok(Number.isSafeInteger(id), "ID must be a safe integer");
  });

  it("generates unique IDs on rapid calls (sequential)", () => {
    const config = makeConfig(dir, "sequential");
    const ids = new Set<number>();
    for (let i = 0; i < 10; i++) {
      ids.add(getNextId(config));
      // Simulate a file being created with that ID
      writeFileSync(join(dir, "backlog", `${String(i + 1).padStart(4, "0")}-task.md`), "");
    }
    assert.equal(ids.size, 10, "all IDs should be unique");
  });
});

describe("formatId", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-counter-"));
  });

  it("pads sequential IDs to padWidth", () => {
    const config = makeConfig(dir, "sequential");
    assert.equal(formatId(1, config), "0001");
    assert.equal(formatId(42, config), "0042");
    assert.equal(formatId(12345, config), "12345");
  });

  it("does not pad timestamp IDs", () => {
    const config = makeConfig(dir, "timestamp");
    assert.equal(formatId(20260331142300, config), "20260331142300");
  });

  it("does not pad ulid IDs", () => {
    const config = makeConfig(dir, "ulid");
    const id = 1234567890123;
    assert.equal(formatId(id, config), "1234567890123");
  });
});
