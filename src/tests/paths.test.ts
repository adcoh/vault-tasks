import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isInsideRoot, toRelPosix } from "../paths.js";

describe("isInsideRoot (posix)", () => {
  const p = path.posix;
  it("accepts the root itself and descendants", () => {
    assert.equal(isInsideRoot("/v", "/v", p), true);
    assert.equal(isInsideRoot("/v", "/v/backlog/archive", p), true);
  });
  it("rejects parents and siblings", () => {
    assert.equal(isInsideRoot("/v", "/", p), false);
    assert.equal(isInsideRoot("/v", "/etc", p), false);
    assert.equal(isInsideRoot("/v", "/v2", p), false);
  });
  it("accepts a child whose name starts with '..'", () => {
    assert.equal(isInsideRoot("/v", "/v/..notes", p), true);
  });
});

describe("isInsideRoot (win32)", () => {
  const w = path.win32;
  it("accepts descendants with backslash or mixed separators", () => {
    assert.equal(isInsideRoot("C:\\vault", "C:\\vault\\backlog", w), true);
    assert.equal(isInsideRoot("C:\\vault", "C:/vault/backlog/archive", w), true);
  });
  it("is case-insensitive on the drive and path, like the filesystem", () => {
    assert.equal(isInsideRoot("C:\\Vault", "c:\\vault\\backlog", w), true);
  });
  it("rejects a path on another drive (relative() returns an absolute path)", () => {
    assert.equal(w.relative("C:\\vault", "D:\\x"), "D:\\x");
    assert.equal(isInsideRoot("C:\\vault", "D:\\x", w), false);
  });
  it("rejects UNC paths and parent escapes", () => {
    assert.equal(isInsideRoot("C:\\vault", "\\\\server\\share\\x", w), false);
    assert.equal(isInsideRoot("C:\\vault", "C:\\vault\\..\\etc", w), false);
  });
});

describe("toRelPosix", () => {
  it("returns forward slashes on win32", () => {
    assert.equal(
      toRelPosix("C:\\vault\\50-backlog\\archive", "C:\\vault", path.win32),
      "50-backlog/archive"
    );
  });
  it("is a plain relative path on posix", () => {
    assert.equal(toRelPosix("/v/a/b.md", "/v", path.posix), "a/b.md");
  });
  it("uses the host path module by default", () => {
    assert.equal(toRelPosix(path.join("root", "a", "b"), "root"), "a/b");
  });
});
