import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "cli.js");

function run(args: string[], cwd: string): string {
  try {
    return execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

describe("CLI integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-cli-"));
    // init vault
    run(["init"], dir);
  });

  it("init creates config and backlog dir", () => {
    assert.ok(existsSync(join(dir, ".vault-tasks.toml")));
    assert.ok(existsSync(join(dir, "50-backlog")));
  });

  it("new + list round-trip", () => {
    run(["new", "Test task", "--priority", "high"], dir);
    const output = run(["list"], dir);
    assert.ok(output.includes("Test task"));
    assert.ok(output.includes("hig"));
  });

  it("search finds tasks", () => {
    run(["new", "Auth bug fix"], dir);
    run(["new", "UI tweak"], dir);
    const output = run(["search", "auth"], dir);
    assert.ok(output.includes("Auth bug fix"));
    assert.ok(!output.includes("UI tweak"));
  });

  it("done removes from default list", () => {
    run(["new", "Finish this"], dir);
    run(["done", "1"], dir);
    const output = run(["list"], dir);
    assert.ok(!output.includes("Finish this"));
  });

  it("--all shows archived tasks in list", () => {
    run(["new", "Done task"], dir);
    run(["done", "1"], dir);
    const output = run(["list", "--all"], dir);
    assert.ok(output.includes("Done task"));
  });

  it("--help shows usage", () => {
    const output = run(["--help"], dir);
    assert.ok(output.includes("vault-tasks"));
    assert.ok(output.includes("Commands:"));
  });

  it("tags lists tags", () => {
    run(["new", "Tagged", "--tags", "ui,auth"], dir);
    const output = run(["tags"], dir);
    assert.ok(output.includes("ui"));
    assert.ok(output.includes("auth"));
  });
});
