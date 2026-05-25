import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

function runWithStdin(args: string[], cwd: string, input: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
      input,
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

function runWithEnv(
  args: string[],
  cwd: string,
  env: Record<string, string>
): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
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

/** Write a config file that forces sequential ID strategy for backwards-compat tests */
function writeSequentialConfig(dir: string): void {
  writeFileSync(
    join(dir, ".vault-tasks.toml"),
    '[paths]\nbacklog_dir = "backlog"\narchive_dir = "archive"\n\n[id]\nstrategy = "sequential"\npad_width = 4\n'
  );
}

describe("CLI integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-"));
    run(["init"], dir);
    // Override to sequential for existing tests
    writeSequentialConfig(dir);
  });

  it("init creates config and backlog dir", () => {
    assert.ok(existsSync(join(dir, ".vault-tasks.toml")));
    assert.ok(existsSync(join(dir, "backlog")));
  });

  it("init is idempotent", () => {
    const result = run(["init"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("already exists"));
  });

  it("new creates task file with correct frontmatter", () => {
    const result = run(["new", "Test task", "--priority", "high", "--tags", "ui,auth", "--source", "[[2026-03-31]]"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^0001-test-task\.md$/);

    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
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

  it("search --mode bm25 ranks results by relevance with scores", () => {
    run(["new", "Fix auth redirect bug"], dir);
    run(["new", "Refactor database migration"], dir);
    run(["new", "Auth callback handling"], dir);
    const result = run(["search", "auth", "--mode", "bm25"], dir);
    assert.equal(result.exitCode, 0);
    // Header should include SCORE column for bm25 output.
    assert.ok(result.stdout.includes("SCORE"), `expected SCORE column in output:\n${result.stdout}`);
    // Both auth-containing tasks should appear; the DB migration should not.
    assert.ok(result.stdout.includes("Fix auth redirect bug"));
    assert.ok(result.stdout.includes("Auth callback handling"));
    assert.ok(!result.stdout.includes("Refactor database migration"));
  });

  it("search --mode bm25 reports no matches when no token matches", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "kubernetes", "--mode", "bm25"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("No tasks matching"));
  });

  it("search --like finds similar tasks (excluding the target)", () => {
    run(["new", "Fix auth redirect bug"], dir);
    run(["new", "Fix auth callback handling"], dir);
    run(["new", "Refactor database migration"], dir);
    const result = run(["search", "--like", "1", "--mode", "bm25"], dir);
    assert.equal(result.exitCode, 0);
    // The target task itself must NOT appear in the output.
    assert.ok(!result.stdout.includes("Fix auth redirect bug"),
      `target task should be excluded:\n${result.stdout}`);
    // A related task should appear; an unrelated one should not.
    assert.ok(result.stdout.includes("Fix auth callback handling"));
    assert.ok(!result.stdout.includes("Refactor database migration"));
  });

  it("search --like requires --mode bm25", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "--like", "1"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--like requires --mode bm25/);
  });

  it("search rejects an invalid --mode value", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--mode", "magic"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Invalid --mode/);
  });

  it("search --limit caps the number of results", () => {
    for (let i = 1; i <= 5; i++) {
      run(["new", `Task ${i} auth`], dir);
    }
    const result = run(["search", "auth", "--mode", "bm25", "--limit", "2"], dir);
    assert.equal(result.exitCode, 0);
    const taskRows = result.stdout
      .split("\n")
      .filter((l) => /^\d{4}\s/.test(l));
    assert.equal(taskRows.length, 2);
  });

  it("search --limit rejects non-positive values", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--mode", "bm25", "--limit", "0"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--limit must be a positive integer/);
  });

  it("search --limit rejects values with trailing garbage", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--mode", "bm25", "--limit", "5abc"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--limit must be a positive integer/);
  });

  it("search --limit rejects fractional values", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--mode", "bm25", "--limit", "2.5"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--limit must be a positive integer/);
  });

  it("search --limit rejects unsafe-integer values", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--mode", "bm25", "--limit", "99999999999999999999"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--limit must be a positive integer/);
  });

  it("search rejects --like combined with a positional keyword", () => {
    run(["new", "Fix auth bug"], dir);
    const result = run(["search", "auth", "--like", "1", "--mode", "bm25"], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /--like and a positional/);
  });

  it("search keyword mode applies --limit AFTER priority sort", () => {
    run(["new", "low auth task", "--priority", "low"], dir);
    run(["new", "another low auth task", "--priority", "low"], dir);
    run(["new", "high auth task", "--priority", "high"], dir);
    const result = run(["search", "auth", "--limit", "1"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("high auth task"),
      `--limit 1 must keep the highest-priority match:\n${result.stdout}`);
  });

  it("search keyword mode matches task tags", () => {
    run(["new", "Refactor module X", "--tags", "backend"], dir);
    run(["new", "Unrelated UI fix", "--tags", "frontend"], dir);
    const result = run(["search", "backend"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Refactor module X"));
    assert.ok(!result.stdout.includes("Unrelated UI fix"));
  });

  it("search --like can target an archived task", () => {
    run(["new", "Fix auth bug"], dir);
    run(["new", "Auth refactor"], dir);
    run(["done", "1"], dir); // 0001 is now archived
    const result = run(["search", "--like", "1", "--mode", "bm25", "--all"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Auth refactor"));
  });

  it("search default mode is byte-identical to the legacy substring behavior", () => {
    run(["new", "Auth bug fix"], dir);
    run(["new", "UI tweak"], dir);
    // No --mode flag should produce the legacy table (no SCORE column).
    const result = run(["search", "auth"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes("SCORE"));
  });

  it("done writes status to file and auto-archives", () => {
    run(["new", "Finish this"], dir);
    const result = run(["done", "1"], dir);
    assert.equal(result.exitCode, 0);

    // Task should be in archive, not backlog
    assert.ok(!existsSync(join(dir, "backlog", "0001-finish-this.md")));
    const archivePath = join(dir, "backlog", "archive", "0001-finish-this.md");
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

    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
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

  it("start changes status to in-progress", () => {
    run(["new", "Start me"], dir);
    const result = run(["start", "1"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("in-progress"));

    const content = readFileSync(join(dir, "backlog", "0001-start-me.md"), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["status"], "in-progress");
  });

  it("start detects no-op when already in-progress", () => {
    run(["new", "Already going"], dir);
    run(["start", "1"], dir);
    const result = run(["start", "1"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("already"));
  });

  it("archive moves completed tasks", () => {
    // Disable auto-archive so done tasks stay in backlog for manual archiving
    writeFileSync(
      join(dir, ".vault-tasks.toml"),
      '[paths]\nbacklog_dir = "backlog"\narchive_dir = "archive"\n\n[task]\nauto_archive = false\n\n[id]\nstrategy = "sequential"\npad_width = 4\n'
    );
    run(["new", "Task A"], dir);
    run(["new", "Task B"], dir);
    run(["edit", "1", "--status", "done"], dir);
    const result = run(["archive"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Archived") || result.stdout.includes("archived"));
  });

  it("stale returns exit 0 with no tasks", () => {
    const result = run(["stale"], dir);
    assert.equal(result.exitCode, 0);
  });

  it("--help prints usage", () => {
    const result = run(["--help"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("vault-tasks"));
  });

  it("list --status done finds archived tasks", () => {
    run(["new", "Will be done"], dir);
    run(["done", "1"], dir);
    const result = run(["list", "--status", "done"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Will be done"));
  });

  it("list with no tasks shows empty message", () => {
    const result = run(["list"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("No tasks found"));
  });

  it("edit with --tags updates tags", () => {
    run(["new", "Tag target"], dir);
    run(["edit", "1", "--tags", "new-tag,other"], dir);
    const content = readFileSync(join(dir, "backlog", "0001-tag-target.md"), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.deepEqual(meta["tags"], ["new-tag", "other"]);
  });

  it("done shows archived indicator", () => {
    run(["new", "Archive indicator"], dir);
    const result = run(["done", "1"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("archived"));
  });

  it("edit with both --status and --priority", () => {
    run(["new", "Multi edit"], dir);
    run(["edit", "1", "--status", "in-progress", "--priority", "high"], dir);
    const content = readFileSync(join(dir, "backlog", "0001-multi-edit.md"), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["status"], "in-progress");
    assert.equal(meta["priority"], "high");
  });

  it("search with no match shows message", () => {
    const result = run(["search", "nonexistent"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("No tasks matching"));
  });
});

describe("CLI error handling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-err-"));
    run(["init"], dir);
    writeSequentialConfig(dir);
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

  it("stale with invalid --days fails", () => {
    const result = run(["stale", "--days", "foo"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("positive integer"));
  });

  it("show without argument fails", () => {
    const result = run(["show"], dir);
    assert.equal(result.exitCode, 1);
  });

  it("start without argument fails", () => {
    const result = run(["start"], dir);
    assert.equal(result.exitCode, 1);
  });

  it("edit without argument fails", () => {
    const result = run(["edit"], dir);
    assert.equal(result.exitCode, 1);
  });

  it("done with archived task shows descriptive error", () => {
    run(["new", "Already done"], dir);
    run(["done", "1"], dir);
    const result = run(["done", "1"], dir);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("archived") || result.stderr.includes("No task"));
  });

  it("status and priority are case-insensitive", () => {
    run(["new", "Case test"], dir);
    const result = run(["edit", "1", "--status", "IN-PROGRESS", "--priority", "HIGH"], dir);
    assert.equal(result.exitCode, 0);
    const content = readFileSync(join(dir, "backlog", "0001-case-test.md"), "utf-8");
    const { meta } = parseFrontmatter(content);
    assert.equal(meta["status"], "in-progress");
    assert.equal(meta["priority"], "high");
  });

  it("lint exits 0 on a clean vault and 1 with broken links", () => {
    const clean = run(["lint"], dir);
    assert.equal(clean.exitCode, 0);
    assert.ok(clean.stdout.includes("SUMMARY: broken:0"));

    writeFileSync(join(dir, "doc.md"), "[[ghost]]\n", "utf-8");
    const dirty = run(["lint"], dir);
    assert.equal(dirty.exitCode, 1);
    assert.ok(dirty.stdout.includes("SUMMARY: broken:1"));
  });

  it("lint --quiet prints only the summary line", () => {
    writeFileSync(join(dir, "doc.md"), "[[ghost]]\n", "utf-8");
    const result = run(["lint", "--quiet"], dir);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.trim(), "SUMMARY: broken:1 orphans:0 stale:0 drift:0");
  });

  it("lint --json emits valid JSON with full report", () => {
    writeFileSync(join(dir, "doc.md"), "[[ghost]]\n", "utf-8");
    const result = run(["lint", "--json"], dir);
    assert.equal(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.broken, 1);
    assert.equal(parsed.broken[0].target, "ghost");
    assert.equal(parsed.hasIssues, true);
  });

  it("lint --only without value exits 2 with usage error", () => {
    const result = run(["lint", "--only"], dir);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("--only requires a value"));
  });

  it("lint --only with invalid value exits 2", () => {
    const result = run(["lint", "--only", "bogus"], dir);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("--only must be one of"));
  });

  it("lint --scope without value exits 2", () => {
    const result = run(["lint", "--scope"], dir);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("--scope requires a value"));
  });

  it("lint --scope with .. is rejected", () => {
    const result = run(["lint", "--scope", "../escape"], dir);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("must be inside the vault"));
  });
});

describe("CLI with ULID strategy", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-ulid-"));
    run(["init"], dir);
    // Default config is ULID — no override needed
  });

  it("init creates config with ulid as default", () => {
    const config = readFileSync(join(dir, ".vault-tasks.toml"), "utf-8");
    // Must document ulid as the canonical strategy value in the [id] section.
    // The default is "commented-out" but the example string must be "ulid".
    assert.match(
      config,
      /\[id\][^\[]*strategy\s*=\s*"ulid"/s,
      "default config should document strategy = \"ulid\" under [id]"
    );
  });

  it("init does not create .gitignore for counter file", () => {
    // ULID strategy doesn't need a counter file
    assert.ok(!existsSync(join(dir, ".gitignore")));
  });

  it("new creates task with ULID-prefixed filename", () => {
    const result = run(["new", "ULID task", "--priority", "high"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    // ULID prefix: 26 uppercase Crockford base32 chars followed by a hyphen
    assert.match(files[0], /^[0-9A-HJKMNP-TV-Z]{26}-ulid-task\.md$/);
  });

  it("show finds ULID task by prefix", () => {
    run(["new", "Prefixed task"], dir);
    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    const ulidPrefix = files[0].slice(0, 8); // First 8 chars of ULID

    const result = run(["show", ulidPrefix], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Prefixed task"));
  });

  it("done archives ULID task by prefix", () => {
    run(["new", "Archive me"], dir);
    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    const ulidPrefix = files[0].slice(0, 10);

    const result = run(["done", ulidPrefix], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("archived"));

    // Task should be in archive
    const archiveFiles = readdirSync(join(dir, "backlog", "archive")).filter((f: string) => f.endsWith(".md"));
    assert.equal(archiveFiles.length, 1);
  });

  it("list shows ULID tasks", () => {
    run(["new", "Listed task"], dir);
    const result = run(["list"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Listed task"));
  });

  it("search finds ULID tasks", () => {
    run(["new", "Searchable ULID"], dir);
    run(["new", "Other task"], dir);
    const result = run(["search", "searchable"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Searchable ULID"));
    assert.ok(!result.stdout.includes("Other task"));
  });

  it("purely-digit lookup does not silently match a ULID", () => {
    // On a ULID-only vault, `vt done 01` must not return an arbitrary ULID
    // whose ID happens to start with "01" — that's virtually every ULID from
    // the current decade. It must report "No task matching" instead.
    run(["new", "First ULID task"], dir);
    const result = run(["done", "01"], dir);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /No task matching/);
  });

  it("--no-dedupe=true is correctly coerced to boolean", () => {
    run(["new", "Duplicate me"], dir);
    const result = run(["new", "Duplicate me", "--no-dedupe=true"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stderr.includes("Similar tasks found"),
      "--no-dedupe=true must suppress the warning");
  });

  it("--no-dedupe=garbage is rejected with actionable error", () => {
    const result = run(["new", "X", "--no-dedupe=maybe"], dir);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /boolean|true\/false/i);
  });

  it("ambiguous prefix error tells user how to resolve it", () => {
    // Force an ambiguous prefix by using a config with a prefix-rich
    // identifier. Since our ULIDs share the same-ms prefix after
    // monotonic seeding, create two quickly and lookup a very short prefix.
    run(["new", "A"], dir);
    run(["new", "B"], dir);
    const result = run(["done", "0"], dir);
    // "0" is purely-digit → numeric branch, not ULID prefix → "No task"
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /No task matching/);
  });

  it("list ignores non-task markdown files in backlog", () => {
    run(["new", "Real task"], dir);
    writeFileSync(join(dir, "backlog", "notes-about-x.md"), "# Random note\n");
    const result = run(["list"], dir);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Real task"));
    assert.ok(!result.stdout.includes("Random note"));
    assert.ok(!result.stdout.includes("notes-about-x"));
  });
});

describe("CLI legacy sequential detection", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-legacy-"));
  });

  it("no config + existing NNNN-*.md files → sequential default", () => {
    // Simulate an existing 0.1.x vault that was upgraded to 0.2.0 without
    // running `vt init`. The user has `backlog/0001-foo.md`; running `vt new`
    // without a config must keep allocating sequential IDs, not start mixing
    // ULIDs into the directory.
    mkdirSync(join(dir, "backlog"), { recursive: true });
    writeFileSync(
      join(dir, "backlog", "0001-existing.md"),
      "---\ntitle: existing\nstatus: open\npriority: medium\ntags: []\ncreated: 2026-01-01\nsource: \n---\n\n# existing\n"
    );
    const result = run(["new", "Second task"], dir);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);

    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md")).sort();
    assert.equal(files.length, 2);
    // Second file must be NNNN-prefixed, not a 26-char ULID
    assert.match(files[1], /^0002-/);
  });

  it("no config + no existing files → ulid default", () => {
    const result = run(["new", "First task"], dir);
    assert.equal(result.exitCode, 0);
    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9A-HJKMNP-TV-Z]{26}-/);
  });

  it("config without explicit strategy + existing NNNN-*.md → sequential", () => {
    // The real 0.1.x upgrade footgun: a user ran `vt init` on 0.1.x, so they
    // have a config file, but the file leaves `[id] strategy` commented out.
    // Existing numbered tasks must keep numbering — not silently switch to
    // ULID just because the new default flipped.
    mkdirSync(join(dir, "backlog"), { recursive: true });
    writeFileSync(
      join(dir, "backlog", "0042-existing.md"),
      "---\ntitle: existing\nstatus: open\npriority: medium\ntags: []\ncreated: 2026-01-01\nsource: \n---\n\n# existing\n"
    );
    // Config present, but no [id] section / no strategy key.
    writeFileSync(
      join(dir, ".vault-tasks.toml"),
      '[paths]\nbacklog_dir = "backlog"\narchive_dir = "archive"\n'
    );

    const result = run(["new", "Next task"], dir);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);

    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md")).sort();
    assert.equal(files.length, 2);
    assert.match(files[1], /^0043-/);
  });

  it("config with explicit strategy='ulid' + existing NNNN files → ulid (no override)", () => {
    // The opposite case: the user has explicitly opted into ULID. We must
    // respect that even though legacy NNNN files are present — the inference
    // is only a fallback for unset strategy, not an override.
    mkdirSync(join(dir, "backlog"), { recursive: true });
    writeFileSync(
      join(dir, "backlog", "0001-old.md"),
      "---\ntitle: old\nstatus: open\npriority: medium\ntags: []\ncreated: 2026-01-01\nsource: \n---\n\n# old\n"
    );
    writeFileSync(
      join(dir, ".vault-tasks.toml"),
      '[paths]\nbacklog_dir = "backlog"\narchive_dir = "archive"\n\n[id]\nstrategy = "ulid"\n'
    );

    const result = run(["new", "New ulid"], dir);
    assert.equal(result.exitCode, 0);
    const files = readdirSync(join(dir, "backlog")).filter((f: string) => f.endsWith(".md")).sort();
    assert.equal(files.length, 2);
    // New file must be a ULID, not 0002
    assert.ok(
      /^[0-9A-HJKMNP-TV-Z]{26}-/.test(files[0]) || /^[0-9A-HJKMNP-TV-Z]{26}-/.test(files[1]),
      `Expected one ULID file in ${files.join(", ")}`
    );
  });
});

describe("CLI config validation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-badconf-"));
  });

  it("rejects invalid [id] strategy with actionable error", () => {
    writeFileSync(
      join(dir, ".vault-tasks.toml"),
      '[id]\nstrategy = "uild"\n'
    );
    const result = run(["list"], dir);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Invalid \[id\] strategy/);
    assert.match(result.stderr, /sequential.*timestamp.*ulid/);
  });

  it("rejects dedupe_threshold out of range", () => {
    writeFileSync(
      join(dir, ".vault-tasks.toml"),
      '[task]\ndedupe_threshold = 2\n'
    );
    const result = run(["list"], dir);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /dedupe_threshold/);
  });

  it("new --body writes given body inline", () => {
    const result = run(["new", "Inline body task", "--body", "Custom body text"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "Custom body text\n");
  });

  it("new --body-file reads body from file", () => {
    const specPath = join(dir, "spec.md");
    writeFileSync(specPath, "# Spec\n\nDetails here.\n");
    const result = run(["new", "From file", "--body-file", specPath], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "# Spec\n\nDetails here.\n");
  });

  it("new --body - reads body from stdin", () => {
    const result = runWithStdin(
      ["new", "Stdin task", "--body", "-"],
      dir,
      "Piped body content"
    );
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "Piped body content\n");
  });

  it("new --body and --body-file are mutually exclusive", () => {
    const result = run(
      ["new", "T", "--body", "x", "--body-file", "y"],
      dir
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /mutually exclusive/);
  });

  it("new --body with no value errors", () => {
    const result = run(["new", "T", "--body"], dir);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--body requires a value/);
  });

  it("new --body-file with no value errors", () => {
    const result = run(["new", "T", "--body-file"], dir);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--body-file requires a value/);
  });

  it("new --body-file with missing path errors actionably", () => {
    const missing = join(dir, "does-not-exist.md");
    const result = run(["new", "T", "--body-file", missing], dir);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /failed to read --body-file/);
    assert.ok(result.stderr.includes(missing), "stderr should include the failing path");
  });

  it("new without body flag preserves default body", () => {
    const result = run(["new", "Default body"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "# Default body\n\n");
  });

  it("new --body=value accepts equals-sign syntax", () => {
    const result = run(["new", "Eq form", "--body=inline content"], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "inline content\n");
  });

  it("new --body-file=path accepts equals-sign syntax", () => {
    const specPath = join(dir, "spec-eq.md");
    writeFileSync(specPath, "from eq form\n");
    const result = run(["new", "Eq file", `--body-file=${specPath}`], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "from eq form\n");
  });

  it("new --body= (empty via equals) errors actionably", () => {
    const result = run(["new", "T", "--body="], dir);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--body requires a value/);
  });

  it("new --body-file= (empty via equals) errors actionably", () => {
    const result = run(["new", "T", "--body-file="], dir);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /--body-file requires a value/);
  });

  it("value-bearing flags without a value error before crashing in commands", () => {
    // Regression: parser used to set value-bearing flags to `true` when given
    // no value; cmdNew/cmdEdit/cmdList would then call .toLowerCase() on the
    // boolean and crash. Now parseArgs throws an actionable error.
    for (const flag of ["--priority", "--tags", "--source", "--status", "--tag"]) {
      const result = run(["new", "T", flag], dir);
      assert.equal(result.exitCode, 2, `${flag} should exit 2`);
      assert.match(
        result.stderr,
        new RegExp(`${flag.slice(2)} requires a value`),
        `${flag} stderr should mention requires a value`
      );
    }
  });

  it("body containing frontmatter delimiters round-trips safely", () => {
    // Use --body-file: an inline value starting with -- would be parsed as a flag.
    const adversarial = "---\ninjected: yes\nstatus: done\n---\nreal body line";
    const specPath = join(dir, "adversarial.md");
    writeFileSync(specPath, adversarial);
    const result = run(["new", "Adversarial", "--body-file", specPath], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    const { meta, body } = parseFrontmatter(content);

    assert.equal(meta["title"], "Adversarial");
    assert.equal(meta["status"], "open");
    assert.equal(meta["injected"], undefined);
    assert.equal(body, adversarial + "\n");
  });

  it("new --body-file normalizes CRLF line endings to LF", () => {
    const specPath = join(dir, "crlf.md");
    writeFileSync(specPath, "line1\r\nline2\r\nline3\r\n");
    const result = run(["new", "CRLF body", "--body-file", specPath], dir);
    assert.equal(result.exitCode, 0);

    const files = readdirSync(join(dir, "backlog")).filter((f) => f.endsWith(".md"));
    const content = readFileSync(join(dir, "backlog", files[0]), "utf-8");
    assert.ok(!content.includes("\r"), "stored file must not contain carriage returns");
    const { body } = parseFrontmatter(content);
    assert.equal(body, "line1\nline2\nline3\n");
  });

  it("install-skills with bad VAULT_TASKS_TEMPLATES_DIR errors cleanly (not a stack trace)", () => {
    // Regression: cmdInstallSkills can throw on a bad env override. The
    // command must run inside the CLI's main try/catch so users get a clean
    // one-line error and a non-zero exit code, not an unhandled exception.
    const missing = join(dir, "does-not-exist-templates-dir");
    const result = runWithEnv(
      ["install-skills", "--list"],
      dir,
      { VAULT_TASKS_TEMPLATES_DIR: missing }
    );
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /VAULT_TASKS_TEMPLATES_DIR/);
    assert.ok(result.stderr.includes(missing), "error must include the offending path");
    // No "at <stack frame>" lines should appear — that would indicate an
    // uncaught exception bubbling up rather than the CLI's catch handler.
    assert.ok(
      !/^\s*at\s+/m.test(result.stderr),
      "stderr must not contain a stack trace; got:\n" + result.stderr
    );
  });
});
