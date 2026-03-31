import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToml } from "../config.js";

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
});
