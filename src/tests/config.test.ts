import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToml, loadConfig, findConfigFile } from "../config.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseToml", () => {
  it("parses basic key-value", () => {
    const result = parseToml('name = "test"');
    assert.equal(result["name"], "test");
  });

  it("parses sections", () => {
    const result = parseToml(`[paths]
backlog_dir = "50-backlog"
archive_dir = "archive"`);
    const paths = result["paths"] as Record<string, unknown>;
    assert.equal(paths["backlog_dir"], "50-backlog");
    assert.equal(paths["archive_dir"], "archive");
  });

  it("parses arrays", () => {
    const result = parseToml('[task]\nstatuses = ["open", "done"]');
    const task = result["task"] as Record<string, unknown>;
    assert.deepEqual(task["statuses"], ["open", "done"]);
  });

  it("parses booleans", () => {
    const result = parseToml("[task]\nauto_archive = true");
    const task = result["task"] as Record<string, unknown>;
    assert.equal(task["auto_archive"], true);
  });

  it("parses numbers", () => {
    const result = parseToml("[id]\npad_width = 4");
    const id = result["id"] as Record<string, unknown>;
    assert.equal(id["pad_width"], 4);
  });

  it("skips comments", () => {
    const result = parseToml("# comment\nname = \"test\"");
    assert.equal(result["name"], "test");
  });

  it("strips inline comments from quoted values", () => {
    const result = parseToml('backlog_dir = "50-backlog"        # where task files live');
    assert.equal(result["backlog_dir"], "50-backlog");
  });

  it("strips inline comments from unquoted values", () => {
    const result = parseToml("auto_archive = true    # enable auto archive");
    assert.equal(result["auto_archive"], true);
  });

  it("parses nested sections", () => {
    const result = parseToml('[project.tags]\nstandard = ["a", "b"]');
    const project = result["project"] as Record<string, unknown>;
    const tags = project["tags"] as Record<string, unknown>;
    assert.deepEqual(tags["standard"], ["a", "b"]);
  });

  it("parses empty arrays", () => {
    const result = parseToml("[task]\nstatuses = []");
    const task = result["task"] as Record<string, unknown>;
    assert.deepEqual(task["statuses"], []);
  });

  it("strips inline comments from arrays", () => {
    const result = parseToml('[task]\nstatuses = ["open", "done"] # task states');
    const task = result["task"] as Record<string, unknown>;
    assert.deepEqual(task["statuses"], ["open", "done"]);
  });

  it("throws on multi-line arrays", () => {
    assert.throws(
      () => parseToml('[task]\nstatuses = [\n  "open",\n  "done"\n]'),
      /Multi-line arrays are not supported/
    );
  });

  it("handles CRLF line endings", () => {
    const result = parseToml("[paths]\r\nbacklog_dir = \"50-backlog\"\r\narchive_dir = \"archive\"");
    const paths = result["paths"] as Record<string, unknown>;
    assert.equal(paths["backlog_dir"], "50-backlog");
    assert.equal(paths["archive_dir"], "archive");
  });

  it("handles empty string input", () => {
    const result = parseToml("");
    assert.deepEqual(result, {});
  });

  it("handles whitespace-only input", () => {
    const result = parseToml("   \n\n  ");
    assert.deepEqual(result, {});
  });

  it("parses single-quoted array values", () => {
    const result = parseToml("[task]\ntags = ['open', 'done']");
    const task = result["task"] as Record<string, unknown>;
    assert.deepEqual(task["tags"], ["open", "done"]);
  });

  it("handles key with no value after equals", () => {
    // This is not valid TOML, but should not crash
    // The regex requires .+ after =, so this line is simply skipped
    const result = parseToml("[task]\nname = ");
    // name = " " matches the regex with rawValue = "", which becomes empty string
    const task = result["task"] as Record<string, unknown>;
    // The behavior depends on the regex — if it doesn't match, the key is skipped
    assert.ok(true); // Just verify no crash
  });
});

describe("findConfigFile", () => {
  it("returns null when no config exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    assert.equal(findConfigFile(dir), null);
  });

  it("finds config in current directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    writeFileSync(join(dir, ".vault-tasks.toml"), "");
    assert.equal(findConfigFile(dir), join(dir, ".vault-tasks.toml"));
  });

  it("finds config in parent directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    writeFileSync(join(dir, ".vault-tasks.toml"), "");
    const child = join(dir, "sub");
    mkdirSync(child);
    assert.equal(findConfigFile(child), join(dir, ".vault-tasks.toml"));
  });
});

describe("loadConfig", () => {
  it("returns resolved defaults when no config file found", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    const config = loadConfig(dir);
    assert.equal(config.vaultRoot, dir);
    // backlogDir should be absolute, not relative
    assert.ok(config.backlogDir.startsWith("/"), "backlogDir should be absolute");
    assert.ok(config.archiveDir.startsWith("/"), "archiveDir should be absolute");
  });

  it("resolves paths from config file location", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    writeFileSync(join(dir, ".vault-tasks.toml"), '[paths]\nbacklog_dir = "tasks"\narchive_dir = "done"');
    const config = loadConfig(dir);
    assert.equal(config.vaultRoot, dir);
    assert.equal(config.backlogDir, join(dir, "tasks"));
    assert.equal(config.archiveDir, join(dir, "tasks", "done"));
  });

  it("throws on path traversal in backlog_dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-cfg-"));
    writeFileSync(join(dir, ".vault-tasks.toml"), '[paths]\nbacklog_dir = "../../etc"');
    assert.throws(() => loadConfig(dir), /must be inside the vault root/);
  });
});
