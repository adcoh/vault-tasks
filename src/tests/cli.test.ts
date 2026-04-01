import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter } from "../frontmatter.js";

const CLI = join(import.meta.dirname, "..", "cli.js");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("CLI integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-"));
    run(["init"], dir);
  });

  it("init creates config and backlog dir", () => {
    assert.ok(existsSync(join(dir, ".vault-tasks.toml")));
    assert.ok(existsSync(join(dir, "50-backlog")));
  });

  it("init is idempotent", () => {
    const result = run(["init"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("already exists"));
  });

  it("new creates task file with correct frontmatter", () => {
    const result = run(["new", "Test task", "--priority", "high", "--tags", "ui,auth", "--source", "[[2026-03-31]]"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "50-backlog")).filter((f: string) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^0001-test-task\.md$/);

    const content = readFileSync(join(dir, "50-backlog", files[0]), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["title"], "Test task");
    assert.equal(meta["status"], "open");
    assert.equal(meta["priority"], "high");
    assert.deepEqual(meta["tags"], ["ui", "auth"]);
    assert.equal(meta["source"], "[[2026-03-31]]");
  });

  it("list shows open tasks with correct columns", () => {
    run(["new", "High pri task", "--priority", "high"], dir);
    run(["new", "Low pri task", "--priority", "low"], dir);
    const result = run(["list"], dir);
    assert.equal(result.exitCode, 0);

    const lines = result.stdout.trim().split("\n");
    assert.ok(lines.length >= 4); // header + divider + 2 tasks
    // High priority should appear before low
    const highIdx = lines.findIndex((l) => l.includes("High pri task"));
    const lowIdx = lines.findIndex((l) => l.includes("Low pri task"));
    assert.ok(highIdx < lowIdx, "high priority should sort before low");
  });

  it("search finds matching tasks and excludes non-matches", () => {
    run(["new", "Auth bug fix"], dir);
    run(["new", "UI tweak"], dir);
    const result = run(["search", "auth"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Auth bug fix"));
    assert.ok(!result.stdout.includes("UI tweak"));
  });

  it("done writes status to file and auto-archives", () => {
    run(["new", "Finish this"], dir);
    const result = run(["done", "1"], dir);
    assert.equal(result.exitCode, 0);

    // Task should be in archive, not backlog
    assert.ok(!existsSync(join(dir, "50-backlog", "0001-finish-this.md")));
    const archivePath = join(dir, "50-backlog", "archive", "0001-finish-this.md");
    assert.ok(existsSync(archivePath));

    // Status should be "done" in the file
    const content = readFileSync(archivePath, "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["status"], "done");
  });

  it("--all shows archived tasks with done status", () => {
    run(["new", "Done task"], dir);
    run(["done", "1"], dir);
    const result = run(["list", "--all"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Done task"));
    assert.ok(result.stdout.includes("done"));
  });

  it("tags lists tag counts", () => {
    run(["new", "A", "--tags", "ui,auth"], dir);
    run(["new", "B", "--tags", "auth"], dir);
    const result = run(["tags"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("auth (2)"));
    assert.ok(result.stdout.includes("ui (1)"));
  });

  it("edit updates priority in file", () => {
    run(["new", "Change me"], dir);
    run(["edit", "1", "--priority", "low"], dir);

    const files = readdirSync(join(dir, "50-backlog")).filter((f: string) => f.endsWith(".md"));
    const content = readFileSync(join(dir, "50-backlog", files[0]), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["priority"], "low");
  });

  it("show outputs full file content", () => {
    run(["new", "Show me", "--tags", "test"], dir);
    const result = run(["show", "1"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("title: Show me"));
    assert.ok(result.stdout.includes("# Show me"));
  });
});

describe("CLI error handling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-err-"));
    run(["init"], dir);
  });

  it("new without title fails with exit code 1", () => {
    const result = run(["new"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Usage"));
  });

  it("done with nonexistent ID fails", () => {
    const result = run(["done", "999"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("No task matching"));
  });

  it("new with invalid priority fails", () => {
    const result = run(["new", "Bad", "--priority", "urgent"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Invalid priority"));
  });

  it("edit with invalid status fails", () => {
    run(["new", "Test"], dir);
    const result = run(["edit", "1", "--status", "blocked"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Invalid status"));
  });

  it("unknown command fails with exit code 1", () => {
    const result = run(["frobnicate"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Unknown command"));
  });
});
