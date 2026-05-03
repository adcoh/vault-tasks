import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { lintVault } from "../lint/index.js";
import { buildIndex, normKey, resolveTarget, stripTargetSuffixes } from "../lint/resolve.js";
import { collectWikilinks, isTemplatePlaceholder, readVaultFiles } from "../lint/collect.js";
import { findBrokenLinks } from "../lint/checks/broken.js";
import { attachSuggestions, computeLeverageFixes } from "../lint/suggest.js";
import type { BrokenEntry } from "../lint/types.js";

function makeConfig(dir: string, overrides: Partial<Config["lint"]> = {}): Config {
  return {
    vaultRoot: dir,
    backlogDir: join(dir, "backlog"),
    archiveDir: join(dir, "backlog", "archive"),
    journalDir: join(dir, "journal"),
    projectsDir: join(dir, "projects"),
    evergreenDir: join(dir, "30-evergreen"),
    statuses: ["open", "in-progress", "done", "wont-do"],
    priorities: ["high", "medium", "low"],
    defaultPriority: "medium",
    defaultStatus: "open",
    archiveStatuses: ["done", "wont-do"],
    autoArchive: true,
    idStrategy: "sequential",
    padWidth: 4,
    slugMaxLength: 60,
    dedupeThreshold: 0.5,
    dedupeScanLimit: 500,
    project: { name: "", qualityCommand: "", testCommand: "", standardTags: [] },
    lint: {
      referenceDir: "40-references",
      referenceExclude: ["tweets/"],
      templateSourceDirs: [".claude/skills/", ".claude/rules/"],
      templateSourceFiles: ["CLAUDE.md"],
      templatePatterns: ["^YYYY", "^<", "^wikilinks?$", "^target$", "^note-name$"],
      skipDirs: [".git", "node_modules"],
      evergreenConventions: {
        requireFrontmatter: true,
        requireTitleField: true,
        requireTagsField: true,
        requireRelatedSection: true,
        requireBodyWikilink: true,
      },
      suggestionThreshold: 0.6,
      ...overrides,
    },
  };
}

function write(dir: string, relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

describe("normKey", () => {
  it("strips whitespace, hyphens, underscores, colons", () => {
    assert.equal(normKey("Bioform AI"), "bioformai");
    assert.equal(normKey("bioform-ai"), "bioformai");
    assert.equal(normKey("bioform_ai"), "bioformai");
    assert.equal(normKey("Bioform: AI"), "bioformai");
    assert.equal(normKey("BIOFORM AI"), "bioformai");
  });

  it("preserves slashes", () => {
    assert.equal(normKey("foo/bar"), "foo/bar");
    assert.equal(normKey("10-areas/parenting/CONTEXT"), "10areas/parenting/context");
  });
});

describe("stripTargetSuffixes", () => {
  it("strips alias", () => {
    assert.equal(stripTargetSuffixes("foo|bar"), "foo");
  });
  it("strips anchor", () => {
    assert.equal(stripTargetSuffixes("foo#section"), "foo");
  });
  it("strips alias when both present", () => {
    assert.equal(stripTargetSuffixes("foo#section|bar"), "foo");
  });
  it("trims whitespace", () => {
    assert.equal(stripTargetSuffixes("  foo  "), "foo");
  });
});

describe("buildIndex + resolveTarget", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-resolve-"));
  });

  it("resolves filename stem case-insensitively", () => {
    write(dir, "case-insensitive.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("CASE-INSENSITIVE", idx), "case-insensitive.md");
    assert.equal(resolveTarget("case insensitive", idx), "case-insensitive.md");
    assert.equal(resolveTarget("Case Insensitive", idx), "case-insensitive.md");
  });

  it("resolves against title: frontmatter", () => {
    write(
      dir,
      "title-fm.md",
      "---\ntitle: \"Some Title\"\n---\nBody"
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("Some Title", idx), "title-fm.md");
    assert.equal(resolveTarget("some-title", idx), "title-fm.md");
  });

  it("resolves against aliases", () => {
    write(
      dir,
      "canonical.md",
      "---\ntitle: Canonical\naliases: [bioform-ai, BioForm]\n---\nBody"
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("bioform ai", idx), "canonical.md");
    assert.equal(resolveTarget("BioForm", idx), "canonical.md");
  });

  it("resolves path-form targets", () => {
    write(dir, "folder/path-form.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("folder/path-form", idx), "folder/path-form.md");
    assert.equal(resolveTarget("folder/Path-Form", idx), "folder/path-form.md");
  });

  it("resolves partial-path tail when unique", () => {
    write(dir, "10-areas/parenting/CONTEXT.md", "Body");
    write(dir, "10-areas/investing/CONTEXT.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(
      resolveTarget("parenting/CONTEXT", idx),
      "10-areas/parenting/CONTEXT.md"
    );
    // Just "CONTEXT" is ambiguous (two files share the basename) — must
    // not silently pick one.
    assert.equal(resolveTarget("CONTEXT", idx), null);
  });

  it("strips |alias and #anchor before resolving", () => {
    write(dir, "target.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("target|display", idx), "target.md");
    assert.equal(resolveTarget("target#section", idx), "target.md");
    assert.equal(resolveTarget("target#section|display", idx), "target.md");
  });

  it("flags collisions on the index", () => {
    write(dir, "Foo Bar.md", "---\ntitle: Foo Bar\n---\nBody");
    write(dir, "foo-bar.md", "---\ntitle: foo bar\n---\nBody");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    const collidedKey = idx.collisions.get("foobar");
    assert.ok(collidedKey, "expected collision under 'foobar'");
    assert.equal(collidedKey!.length, 2);
  });
});

describe("collectWikilinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-collect-"));
  });

  it("skips fenced code blocks", () => {
    write(
      dir,
      "doc.md",
      "Real [[real-link]]\n\n```\nExample [[fake-link]]\n```\n\nAnother [[another]]"
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(files, [], [], []);
    const targets = links.map((l) => l.target);
    assert.deepEqual(targets, ["real-link", "another"]);
  });

  it("skips inline code spans", () => {
    write(dir, "doc.md", "Use `[[example]]` to mean the wikilink form. Real: [[actual]]");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(files, [], [], []);
    const targets = links.map((l) => l.target);
    assert.deepEqual(targets, ["actual"]);
  });

  it("skips template placeholders inside template-source directories", () => {
    write(dir, ".claude/skills/foo/SKILL.md", "Use [[YYYY-MM-DD]] and [[<filename>]]");
    write(dir, "real.md", "[[YYYY-MM-DD]] is a real link here");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(
      files,
      [".claude/skills/", ".claude/rules/"],
      ["CLAUDE.md"],
      ["^YYYY", "^<"]
    );
    // Inside template source: filtered.
    const fromSkill = links.filter((l) => l.source.startsWith(".claude/skills"));
    assert.equal(fromSkill.length, 0);
    // Outside: kept.
    const fromReal = links.filter((l) => l.source === "real.md");
    assert.equal(fromReal.length, 1);
    assert.equal(fromReal[0].target, "YYYY-MM-DD");
  });

  it("strips alias and anchor on collected target", () => {
    write(dir, "doc.md", "[[foo|display]] [[bar#section]]");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(files, [], [], []);
    const targets = links.map((l) => l.target);
    assert.deepEqual(targets, ["foo", "bar"]);
  });

  it("isTemplatePlaceholder is exact for template files", () => {
    const compiled = [/^YYYY/, /^<filename>$/];
    assert.equal(
      isTemplatePlaceholder("YYYY-MM-DD", "CLAUDE.md", [], ["CLAUDE.md"], compiled),
      true
    );
    assert.equal(
      isTemplatePlaceholder("real-name", "CLAUDE.md", [], ["CLAUDE.md"], compiled),
      false
    );
    assert.equal(
      isTemplatePlaceholder("YYYY-MM-DD", "real.md", [], ["CLAUDE.md"], compiled),
      false
    );
  });
});

describe("findBrokenLinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-broken-"));
  });

  it("aggregates by target and sorts by frequency desc", () => {
    write(dir, "exists.md", "Body");
    write(dir, "a.md", "[[missing]]");
    write(dir, "b.md", "[[missing]]");
    write(dir, "c.md", "[[missing]]");
    write(dir, "d.md", "[[other-missing]]");
    write(dir, "e.md", "[[exists]]");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(files, [], [], []);
    const idx = buildIndex(files);
    const broken = findBrokenLinks(links, idx);
    assert.equal(broken.length, 2);
    assert.equal(broken[0].target, "missing");
    assert.equal(broken[0].count, 3);
    assert.equal(broken[1].target, "other-missing");
    assert.equal(broken[1].count, 1);
  });
});

describe("attachSuggestions", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-suggest-"));
  });

  it("suggests files based on basename similarity", () => {
    write(dir, "bioform-ai.md", "---\ntitle: BioForm AI\n---\nBody");
    write(dir, "broken.md", "[[bioform ai]]");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectWikilinks(files, [], [], []);
    const idx = buildIndex(files);
    // Nothing's broken because resolution succeeds via title match.
    // Test the suggestion engine directly with a forced broken entry.
    const broken: BrokenEntry[] = [
      {
        target: "bioformai-different",
        count: 1,
        locations: [{ source: "broken.md", line: 1 }],
        suggestions: [],
      },
    ];
    attachSuggestions(broken, idx, 0.5);
    assert.ok(broken[0].suggestions.length > 0);
    const top = broken[0].suggestions[0];
    assert.equal(top.filePath, "bioform-ai.md");
    assert.ok(top.similarity >= 0.5);
  });

  it("respects threshold cutoff", () => {
    write(dir, "alpha-beta.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    const broken: BrokenEntry[] = [
      {
        target: "completely-unrelated-target-xyzzy",
        count: 1,
        locations: [{ source: "x.md", line: 1 }],
        suggestions: [],
      },
    ];
    attachSuggestions(broken, idx, 0.6);
    assert.equal(broken[0].suggestions.length, 0);
  });

  it("computes leverage fixes summed across broken targets", () => {
    write(dir, "canonical.md", "---\ntitle: Canonical\n---\nBody");
    const idx = buildIndex(
      readVaultFiles(dir, [".git", "node_modules"], () => {})
    );
    const broken: BrokenEntry[] = [
      {
        target: "canonicaal", // typo, similar to "canonical"
        count: 5,
        locations: [],
        suggestions: [],
      },
      {
        target: "canonacal", // another typo
        count: 3,
        locations: [],
        suggestions: [],
      },
    ];
    attachSuggestions(broken, idx, 0.5);
    const fixes = computeLeverageFixes(broken);
    assert.equal(fixes.length, 1);
    assert.equal(fixes[0].filePath, "canonical.md");
    assert.equal(fixes[0].closes, 8);
    assert.equal(fixes[0].aliases.length, 2);
  });
});

describe("lintVault", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-e2e-"));
  });

  it("reports zero issues on a clean vault", () => {
    write(
      dir,
      "30-evergreen/note.md",
      "---\ntitle: Note\ntags: [foo]\n---\n# Note\n\n[[other]]\n\n## Related\n\n[[other]]"
    );
    write(dir, "30-evergreen/other.md", "---\ntitle: Other\ntags: [foo]\n---\n# Other\n\n[[note]]\n\n## Related\n\n[[note]]");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg);
    assert.equal(report.summary.broken, 0);
    assert.equal(report.summary.orphans, 0);
    assert.equal(report.summary.drift, 0);
    assert.equal(report.hasIssues, false);
  });

  it("detects broken, orphan, stale, and drift in one pass", () => {
    // Broken: one file links to [[ghost]] which doesn't exist
    write(dir, "01-journal/2026.md", "[[ghost]]");
    // Orphan: an evergreen with no incoming links
    write(
      dir,
      "30-evergreen/lonely.md",
      "---\ntitle: Lonely\ntags: [x]\n---\n# Lonely\n\n[[somewhere]]\n\n## Related"
    );
    // Drift: an evergreen missing all conventions
    write(dir, "30-evergreen/messy.md", "Just text, no frontmatter or headings");
    // Stale: a reference with no incoming links
    write(dir, "40-references/abandoned.md", "Body");
    // Resolution target for [[somewhere]]
    write(dir, "30-evergreen/somewhere.md", "---\ntitle: Somewhere\ntags: [x]\n---\n# Somewhere\n\n[[lonely]]\n\n## Related");

    const cfg = makeConfig(dir);
    const report = lintVault(cfg);

    assert.ok(report.summary.broken >= 1, "expected at least one broken link");
    assert.ok(report.summary.orphans >= 1, "expected at least one orphan");
    assert.ok(report.summary.stale >= 1, "expected at least one stale reference");
    assert.ok(report.summary.drift >= 1, "expected at least one drift");
    assert.equal(report.hasIssues, true);
  });

  it("respects --only filter", () => {
    write(dir, "30-evergreen/messy.md", "no convention");
    write(dir, "j.md", "[[ghost]]");
    const cfg = makeConfig(dir);
    const onlyBroken = lintVault(cfg, { only: "broken" });
    assert.ok(onlyBroken.summary.broken >= 1);
    assert.equal(onlyBroken.summary.drift, 0);
    const onlyDrift = lintVault(cfg, { only: "drift" });
    assert.equal(onlyDrift.summary.broken, 0);
    assert.ok(onlyDrift.summary.drift >= 1);
  });

  it("respects per-file lint_orphan_ok opt-out", () => {
    write(
      dir,
      "30-evergreen/inbox.md",
      "---\ntitle: Inbox\ntags: [x]\nlint_orphan_ok: true\n---\n# Inbox\n\n[[noop]]\n\n## Related"
    );
    write(dir, "30-evergreen/noop.md", "---\ntitle: Noop\ntags: [x]\n---\n# Noop\n\n[[inbox]]\n\n## Related");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { only: "orphans" });
    assert.equal(report.summary.orphans, 0);
  });

  it("emits collision warnings", () => {
    write(dir, "Foo Bar.md", "---\ntitle: Foo Bar\n---\nBody");
    write(dir, "foo-bar.md", "Body");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg);
    assert.ok(
      report.warnings.some((w) => w.includes("share normalised key")),
      "expected a collision warning"
    );
  });

  it("scopes to a subdir without breaking resolution", () => {
    // [[shared]] lives outside the scope; it should still resolve so the
    // link inside the scope is not falsely flagged as broken.
    write(dir, "shared.md", "---\ntitle: Shared\n---\nBody");
    write(dir, "30-evergreen/note.md", "---\ntitle: Note\ntags: [x]\n---\n# Note\n\n[[shared]]\n\n## Related");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { scope: "30-evergreen" });
    assert.equal(report.summary.broken, 0);
  });

  it("CRLF input does not break collection", () => {
    write(dir, "doc.md", "Line one\r\n[[ghost]]\r\nLine three\r\n");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { only: "broken" });
    assert.equal(report.summary.broken, 1);
    assert.equal(report.broken[0].target, "ghost");
  });
});
