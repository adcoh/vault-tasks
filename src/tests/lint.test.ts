import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { lintVault } from "../lint/index.js";
import { buildIndex, normKey, resolveTarget, stripTargetSuffixes } from "../lint/resolve.js";
import {
  collectLinks,
  collectWikilinks,
  isTemplatePlaceholder,
  readVaultFiles,
} from "../lint/collect.js";
import { findBrokenLinks } from "../lint/checks/broken.js";
import { attachSuggestions, computeLeverageFixes } from "../lint/suggest.js";
import { formatHumanReport, formatJsonReport, formatSummaryLine } from "../lint/report.js";
import type { BrokenEntry, LintReport } from "../lint/types.js";

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
      referenceDir: join(dir, "40-references"),
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
    search: {
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      embeddingDimensions: null,
      embeddingEndpoint: "",
      embeddingApiKeyEnv: "",
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
    write(dir, "title-fm.md", '---\ntitle: "Some Title"\n---\nBody');
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const idx = buildIndex(files);
    assert.equal(resolveTarget("Some Title", idx), "title-fm.md");
    assert.equal(resolveTarget("some-title", idx), "title-fm.md");
  });

  it("resolves against aliases", () => {
    write(dir, "canonical.md", "---\ntitle: Canonical\naliases: [bioform-ai, BioForm]\n---\nBody");
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
    assert.equal(resolveTarget("parenting/CONTEXT", idx), "10-areas/parenting/CONTEXT.md");
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

describe("collectLinks — markdown links", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-mdlink-"));
  });

  it("collects a local markdown link as a resolvable target", () => {
    write(dir, "notes/doc.md", "See [the other note](./other.md) for detail.");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectLinks(files, [], [], []);
    assert.deepEqual(
      links.map((l) => ({ target: l.target, kind: l.kind })),
      [{ target: "notes/other", kind: "md" }]
    );
  });

  it("collects wikilinks alongside markdown links, each tagged by kind", () => {
    write(dir, "doc.md", "A [[wiki-target]] and a [md](./md-target.md).");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectLinks(files, [], [], []);
    assert.deepEqual(
      links.map((l) => ({ target: l.target, kind: l.kind })),
      [
        { target: "wiki-target", kind: "wiki" },
        { target: "md-target", kind: "md" },
      ]
    );
  });

  it("resolves markdown links relative to the source file's directory", () => {
    write(dir, "a/b/doc.md", "Up two: [x](../../top.md) and up one: [y](../sib.md)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    const links = collectLinks(files, [], [], []);
    assert.deepEqual(
      links.map((l) => l.target),
      ["top", "a/sib"]
    );
  });

  it("ignores external URLs, bare anchors, and non-markdown targets", () => {
    write(
      dir,
      "doc.md",
      [
        "[http](https://example.com/page.md)",
        "[proto](//cdn.example.com/x.md)",
        "[mail](mailto:someone@example.com)",
        "[anchor](#a-section)",
        "[pdf](./file.pdf)",
        "[img](./pic.png)",
      ].join("\n")
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(collectLinks(files, [], [], []), []);
  });

  it("strips the anchor and percent-decodes the path", () => {
    write(dir, "doc.md", "[a](./My%20Note.md#heading)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      collectLinks(files, [], [], []).map((l) => l.target),
      ["My Note"]
    );
  });

  it("does not misread an aliased wikilink as a markdown link", () => {
    write(dir, "doc.md", "[[real-target|display text]]");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      collectLinks(files, [], [], []).map((l) => ({ target: l.target, kind: l.kind })),
      [{ target: "real-target", kind: "wiki" }]
    );
  });

  it("skips markdown links inside fenced blocks and inline code", () => {
    write(
      dir,
      "doc.md",
      "```\n[fenced](./nope.md)\n```\n\nInline `[code](./nope2.md)` then [real](./yes.md)"
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      collectLinks(files, [], [], []).map((l) => l.target),
      ["yes"]
    );
  });

  it("does not escape the vault root", () => {
    write(dir, "doc.md", "[out](../../../etc/passwd.md)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(collectLinks(files, [], [], []), []);
  });

  it("reads angle-bracket destinations containing spaces", () => {
    write(dir, "doc.md", "[note](<./My Note.md>)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      collectLinks(files, [], [], []).map((l) => l.target),
      ["My Note"]
    );
  });

  it("reads a bare destination containing balanced parentheses", () => {
    write(dir, "doc.md", "[x](./Report(2026).md)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      collectLinks(files, [], [], []).map((l) => l.target),
      ["Report(2026)"]
    );
  });

  it("rejects a target whose decoded href smuggles control characters", () => {
    // %0A decodes to a newline, which would otherwise reach the broken-link
    // report and forge output lines.
    write(dir, "doc.md", "[x](./missing%0Ainjected.md)");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(collectLinks(files, [], [], []), []);
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
    const _links = collectWikilinks(files, [], [], []);
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
    const idx = buildIndex(readVaultFiles(dir, [".git", "node_modules"], () => {}));
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

  it("produces byte-identical suggestions to v0.6.0 for a fixed fixture", () => {
    // Regression fixture for the trigram-set-hoisting optimization (issue
    // #30, cause 2): attachSuggestions must produce exactly the same
    // suggestions (paths, kinds, similarity values, order) it did before the
    // hoist. Expected values below were captured from v0.6.0's
    // similarity()-per-comparison implementation and are encoded literally
    // — this test must NOT call similarity()/the old code path to derive
    // them, or it would validate nothing after the refactor.
    write(dir, "quarterly-plan.md", "---\ntitle: Quarterly Plan\naliases: [Q Plan]\n---\nBody");
    write(dir, "quarterly-review.md", "---\ntitle: Quarterly Review\n---\nBody");
    write(dir, "annual-report.md", "---\ntitle: Annual Report\n---\nBody");
    const idx = buildIndex(readVaultFiles(dir, [".git", "node_modules"], () => {}));

    const broken: BrokenEntry[] = [
      {
        target: "quartely plan",
        count: 2,
        locations: [{ source: "a.md", line: 1 }],
        suggestions: [],
      },
      {
        target: "anual repot",
        count: 1,
        locations: [{ source: "b.md", line: 3 }],
        suggestions: [],
      },
    ];

    attachSuggestions(broken, idx, 0.3);

    // The `kind: "title"` pick below is a locale-sensitive tie-break, not
    // an arbitrary encoding: "quarterly-plan" (basename) and "Quarterly
    // Plan" (title) score identically for "quartely plan" and tie on
    // length (14 chars each), so the candidate sort's final clause,
    // `String.prototype.localeCompare`, decides the order — that's ICU
    // collation, not byte order. If a Node/ICU upgrade ever flips this to
    // "basename", that's the mechanism to look at, not a scoring bug.
    assert.deepEqual(broken[0].suggestions, [
      {
        filePath: "quarterly-plan.md",
        candidate: "Quarterly Plan",
        kind: "title",
        similarity: 0.8148148148148148,
        proposedAlias: "quartely plan",
      },
      {
        filePath: "quarterly-review.md",
        candidate: "Quarterly Review",
        kind: "title",
        similarity: 0.41379310344827586,
        proposedAlias: "quartely plan",
      },
    ]);

    assert.deepEqual(broken[1].suggestions, [
      {
        filePath: "annual-report.md",
        candidate: "Annual Report",
        kind: "title",
        similarity: 0.6666666666666666,
        proposedAlias: "anual repot",
      },
    ]);
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
    write(
      dir,
      "30-evergreen/other.md",
      "---\ntitle: Other\ntags: [foo]\n---\n# Other\n\n[[note]]\n\n## Related\n\n[[note]]"
    );
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
    write(
      dir,
      "30-evergreen/somewhere.md",
      "---\ntitle: Somewhere\ntags: [x]\n---\n# Somewhere\n\n[[lonely]]\n\n## Related"
    );

    const cfg = makeConfig(dir);
    const report = lintVault(cfg);

    // Exact counts — the fixture is deterministic.
    assert.deepEqual(report.summary, {
      broken: 1,
      orphans: 1,
      stale: 1,
      drift: 1,
    });
    assert.equal(report.broken[0].target, "ghost");
    assert.equal(report.broken[0].count, 1);
    assert.deepEqual(report.orphans, ["30-evergreen/messy.md"]);
    assert.deepEqual(report.stale, ["40-references/abandoned.md"]);
    assert.equal(report.drift[0].filePath, "30-evergreen/messy.md");
    assert.deepEqual(report.drift[0].issues, [
      "no frontmatter",
      "no wikilinks in body",
      "no ## Related section",
    ]);
    assert.equal(report.hasIssues, true);
  });

  it("respects --only filter", () => {
    write(dir, "30-evergreen/messy.md", "no convention");
    write(dir, "j.md", "[[ghost]]");
    const cfg = makeConfig(dir);
    const onlyBroken = lintVault(cfg, { only: "broken" });
    assert.equal(onlyBroken.summary.broken, 1);
    assert.equal(onlyBroken.broken[0].target, "ghost");
    assert.equal(onlyBroken.summary.drift, 0);
    const onlyDrift = lintVault(cfg, { only: "drift" });
    assert.equal(onlyDrift.summary.broken, 0);
    assert.equal(onlyDrift.summary.drift, 1);
    assert.equal(onlyDrift.drift[0].filePath, "30-evergreen/messy.md");
  });

  it("respects per-file lint_orphan_ok opt-out", () => {
    write(
      dir,
      "30-evergreen/inbox.md",
      "---\ntitle: Inbox\ntags: [x]\nlint_orphan_ok: true\n---\n# Inbox\n\n[[noop]]\n\n## Related"
    );
    write(
      dir,
      "30-evergreen/noop.md",
      "---\ntitle: Noop\ntags: [x]\n---\n# Noop\n\n[[inbox]]\n\n## Related"
    );
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { only: "orphans" });
    assert.equal(report.summary.orphans, 0);
  });

  it("does not report an evergreen as orphaned when its only inbound link is a markdown link", () => {
    write(
      dir,
      "30-evergreen/target.md",
      "---\ntitle: Target\ntags: [x]\n---\n# Target\n\n[[other]]\n\n## Related"
    );
    write(
      dir,
      "30-evergreen/other.md",
      "---\ntitle: Other\ntags: [x]\n---\n# Other\n\nSee [Target](./target.md)\n\n## Related"
    );
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { only: "orphans" });
    assert.deepEqual(report.orphans, []);
  });

  it("reports a broken markdown link alongside broken wikilinks", () => {
    write(dir, "doc.md", "[gone](./missing-note.md)");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { only: "broken" });
    assert.deepEqual(
      report.broken.map((b) => b.target),
      ["missing-note"]
    );
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
    write(
      dir,
      "30-evergreen/note.md",
      "---\ntitle: Note\ntags: [x]\n---\n# Note\n\n[[shared]]\n\n## Related"
    );
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

  it("forwards warnings to onWarn AND retains them in the report", () => {
    write(dir, "Foo Bar.md", "---\ntitle: Foo Bar\n---\nBody");
    write(dir, "foo-bar.md", "Body");
    const seen: string[] = [];
    const cfg = makeConfig(dir);
    const report = lintVault(cfg, { onWarn: (m) => seen.push(m) });
    assert.ok(seen.length > 0, "onWarn callback should fire");
    assert.deepEqual(report.warnings, seen);
  });
});

describe("report formatters", () => {
  function makeReport(overrides: Partial<LintReport> = {}): LintReport {
    return {
      broken: [],
      orphans: [],
      stale: [],
      drift: [],
      leverageFixes: [],
      warnings: [],
      summary: { broken: 0, orphans: 0, stale: 0, drift: 0 },
      hasIssues: false,
      ...overrides,
    };
  }

  it("formatSummaryLine produces the exact log-appendable string", () => {
    const r = makeReport({ summary: { broken: 3, orphans: 1, stale: 0, drift: 2 } });
    assert.equal(formatSummaryLine(r), "SUMMARY: broken:3 orphans:1 stale:0 drift:2");
  });

  it("formatSummaryLine on a clean report", () => {
    assert.equal(formatSummaryLine(makeReport()), "SUMMARY: broken:0 orphans:0 stale:0 drift:0");
  });

  it("formatJsonReport round-trips through JSON.parse", () => {
    const r = makeReport({
      broken: [
        {
          target: "ghost",
          count: 2,
          locations: [
            { source: "a.md", line: 1 },
            { source: "b.md", line: 5 },
          ],
          suggestions: [
            {
              filePath: "ghost-real.md",
              candidate: "ghost-real",
              kind: "basename",
              similarity: 0.85,
              proposedAlias: "ghost",
            },
          ],
        },
      ],
      orphans: ["evergreen/lonely.md"],
      summary: { broken: 1, orphans: 1, stale: 0, drift: 0 },
      hasIssues: true,
    });
    const json = formatJsonReport(r);
    const parsed = JSON.parse(json);
    assert.equal(parsed.summary.broken, 1);
    assert.equal(parsed.summary.orphans, 1);
    assert.equal(parsed.broken[0].target, "ghost");
    assert.equal(parsed.broken[0].count, 2);
    assert.equal(parsed.broken[0].suggestions[0].filePath, "ghost-real.md");
    assert.deepEqual(parsed.orphans, ["evergreen/lonely.md"]);
    assert.equal(parsed.hasIssues, true);
  });

  it("formatHumanReport renders all sections with counts", () => {
    const r = makeReport({
      broken: [
        {
          target: "ghost",
          count: 3,
          locations: [
            { source: "a.md", line: 1 },
            { source: "b.md", line: 2 },
            { source: "c.md", line: 3 },
          ],
          suggestions: [
            {
              filePath: "ghost-real.md",
              candidate: "ghost-real",
              kind: "basename",
              similarity: 0.85,
              proposedAlias: "ghost",
            },
          ],
        },
      ],
      orphans: ["30-evergreen/lonely.md"],
      stale: ["40-references/abandoned.md"],
      drift: [{ filePath: "30-evergreen/messy.md", issues: ["no frontmatter"] }],
      leverageFixes: [
        {
          action: "add alias to ghost-real.md",
          closes: 3,
          filePath: "ghost-real.md",
          aliases: ["ghost"],
        },
      ],
      warnings: ["2 files share normalised key 'foo': a.md, b.md"],
      summary: { broken: 1, orphans: 1, stale: 1, drift: 1 },
      hasIssues: true,
    });
    const out = formatHumanReport(r);

    assert.ok(out.includes("=== WARNINGS (1) ==="));
    assert.ok(out.includes("share normalised key"));
    assert.ok(out.includes("=== HIGH-LEVERAGE FIXES (1) ==="));
    assert.ok(out.includes("add alias to ghost-real.md"));
    assert.ok(out.includes("closes 3 broken links"));
    assert.ok(out.includes("=== BROKEN WIKILINKS (1) ==="));
    assert.ok(out.includes("[[ghost]]  (3 occurrences)"));
    assert.ok(out.includes("suggest: ghost-real.md"));
    assert.ok(out.includes("a.md:1"));
    assert.ok(out.includes("=== ORPHAN EVERGREENS (1) ==="));
    assert.ok(out.includes("30-evergreen/lonely.md"));
    assert.ok(out.includes("=== STALE REFERENCES (1) ==="));
    assert.ok(out.includes("40-references/abandoned.md"));
    assert.ok(out.includes("=== CONVENTION DRIFT (1) ==="));
    assert.ok(out.includes("30-evergreen/messy.md: no frontmatter"));
    assert.ok(out.endsWith("SUMMARY: broken:1 orphans:1 stale:1 drift:1"));
  });

  it("formatHumanReport truncates locations beyond MAX with '+N more'", () => {
    const locations = Array.from({ length: 7 }, (_, i) => ({
      source: `f${i}.md`,
      line: i + 1,
    }));
    const r = makeReport({
      broken: [{ target: "ghost", count: 7, locations, suggestions: [] }],
      summary: { broken: 1, orphans: 0, stale: 0, drift: 0 },
      hasIssues: true,
    });
    const out = formatHumanReport(r);
    // First 3 visible, then "+4 more"
    assert.ok(out.includes("f0.md:1"));
    assert.ok(out.includes("f1.md:2"));
    assert.ok(out.includes("f2.md:3"));
    assert.ok(out.includes("... +4 more"));
    assert.ok(!out.includes("f6.md"));
  });

  it("formatHumanReport handles fully-clean report", () => {
    const out = formatHumanReport(makeReport());
    assert.ok(out.includes("=== BROKEN WIKILINKS (0) ==="));
    assert.ok(out.includes("=== ORPHAN EVERGREENS (0) ==="));
    assert.ok(out.includes("=== STALE REFERENCES (0) ==="));
    assert.ok(out.includes("=== CONVENTION DRIFT (0) ==="));
    assert.ok(!out.includes("WARNINGS"));
    assert.ok(!out.includes("HIGH-LEVERAGE FIXES"));
  });
});

describe("config validation for [lint]", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-cfg-"));
  });

  it("rejects an invalid template_patterns regex with file context", async () => {
    const { loadConfig } = await import("../config.js");
    write(dir, ".vault-tasks.toml", `[lint]\ntemplate_patterns = ["valid", "[unclosed"]\n`);
    assert.throws(() => loadConfig(dir), /template_patterns\[1\]:.*"\[unclosed"/);
  });

  it("rejects suggestion_threshold outside 0..1", async () => {
    const { loadConfig } = await import("../config.js");
    write(dir, ".vault-tasks.toml", `[lint]\nsuggestion_threshold = 2\n`);
    assert.throws(() => loadConfig(dir), /suggestion_threshold/);
  });

  it("loadConfig returns absolute referenceDir", async () => {
    const { loadConfig } = await import("../config.js");
    write(dir, ".vault-tasks.toml", `[lint]\nreference_dir = "my-refs"\n`);
    const cfg = loadConfig(dir);
    assert.ok(
      cfg.lint.referenceDir.startsWith(dir),
      `expected absolute path under ${dir}, got ${cfg.lint.referenceDir}`
    );
  });

  it("loadConfig returns absolute referenceDir even with no config file", async () => {
    const { loadConfig } = await import("../config.js");
    const cfg = loadConfig(dir);
    assert.ok(
      cfg.lint.referenceDir.startsWith(dir),
      `expected absolute path under ${dir}, got ${cfg.lint.referenceDir}`
    );
  });
});

describe("walkMarkdown (security)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-walk-"));
  });

  it("does not follow directory symlinks (read only what's inside the vault)", async () => {
    const { symlinkSync, mkdirSync } = await import("node:fs");
    // External directory containing a markdown file the lint must NOT see.
    const outside = mkdtempSync(join(tmpdir(), "vt-outside-"));
    write(outside, "secret.md", "[[exfiltrate]]");
    // Symlink inside the vault pointing at the external dir.
    mkdirSync(dir, { recursive: true });
    try {
      symlinkSync(outside, join(dir, "linked"));
    } catch (err) {
      // Some CI environments disable symlink creation. Skip rather than fail.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return;
      throw err;
    }
    write(dir, "real.md", "real body");
    const cfg = makeConfig(dir);
    const report = lintVault(cfg);
    // No broken-link findings should be sourced from `linked/secret.md`.
    const sources = report.broken.flatMap((b) => b.locations.map((l) => l.source));
    for (const s of sources) {
      assert.ok(
        !s.includes("linked/"),
        `walker should not have descended into the symlinked dir; saw: ${s}`
      );
    }
  });
});

describe("walkMarkdown (git worktree skipping)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vt-lint-worktree-"));
  });

  it("matches multi-segment skipDirs entries at depth", () => {
    write(dir, "sub/.claude/worktrees/a/n.md", "Body");
    write(dir, "sub/real.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules", ".claude/worktrees"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["sub/real.md"]
    );
  });

  it("skips a .worktrees skipDirs entry", () => {
    write(dir, "b.md", "Body");
    write(dir, ".worktrees/wt2/b.md", "Duplicate");
    const files = readVaultFiles(dir, [".git", "node_modules", ".worktrees"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["b.md"]
    );
  });

  it("lints exactly the real file when a .claude/worktrees copy duplicates the vault", () => {
    write(dir, "notes/a.md", "---\ntitle: A\n---\nReal body\n\n[[b]]");
    write(dir, "notes/b.md", "---\ntitle: B\n---\nReal body");
    // The worktree copy links a target that exists nowhere in the vault
    // (real or copy). If the copy were walked despite skipDirs, this link
    // would resolve to nothing and report.summary.broken would be > 0 —
    // making that assertion actually load-bearing instead of trivially
    // true (a copy of `[[b]]` would resolve fine either way).
    write(
      dir,
      ".claude/worktrees/wt1/notes/a.md",
      "---\ntitle: A\n---\nDuplicate body\n\n[[only-in-worktree-target]]"
    );
    write(dir, ".claude/worktrees/wt1/notes/b.md", "---\ntitle: B\n---\nDuplicate body");
    const cfg = makeConfig(dir, { skipDirs: [".git", "node_modules", ".claude/worktrees"] });
    const report = lintVault(cfg);
    assert.equal(
      report.warnings.some((w) => w.includes("share normalised key")),
      false,
      "worktree copy must not surface as a duplicate-key collision"
    );
    assert.equal(report.summary.broken, 0);
    const files = readVaultFiles(dir, cfg.lint.skipDirs, () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["notes/a.md", "notes/b.md"]
    );
  });

  it("lints exactly the real file when a .venv site-packages copy collides on basename", async () => {
    // Uses real production defaults (via loadConfig, no .vault-tasks.toml
    // present) rather than makeConfig's stripped-down skipDirs, so this
    // actually exercises DEFAULT_LINT.skipDirs — a Python virtualenv's
    // site-packages can ship its own markdown (e.g. a package's AGENTS.md)
    // that collides on basename with real vault notes.
    const { loadConfig } = await import("../config.js");
    write(dir, "notes/a.md", "---\ntitle: A\n---\nReal body\n\n[[b]]");
    write(dir, "notes/b.md", "---\ntitle: B\n---\nReal body");
    write(dir, ".venv/lib/site-packages/pkg/b.md", "Some unrelated package markdown");
    const cfg = loadConfig(dir);
    const report = lintVault(cfg);
    assert.equal(
      report.warnings.some((w) => w.includes("share normalised key")),
      false,
      ".venv copy must not surface as a basename collision"
    );
    assert.equal(report.summary.broken, 0);
    const files = readVaultFiles(dir, cfg.lint.skipDirs, () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["notes/a.md", "notes/b.md"]
    );
  });

  it("skips a subdirectory that contains a .git regular file (a git worktree)", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: /elsewhere/.git/worktrees/foo\n");
    write(dir, "real.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["real.md"]
    );
  });

  it("walks a directory whose .git file points at a submodule gitdir, not a worktree", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: ../.git/modules/x\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("skips a worktree-shaped .git file using backslash separators", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: C:\\repo\\.git\\worktrees\\wt1\n");
    write(dir, "real.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["real.md"]
    );
  });

  it("walks a submodule literally named 'worktrees' (last segment, not penultimate)", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: ../.git/modules/worktrees\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("walks a submodule mounted at a superproject path named 'worktrees' (gitdir: .../modules/worktrees/foo)", () => {
    // CodeRabbit finding on PR #31: a submodule at superproject path
    // "worktrees/<name>" has gitdir ".../modules/worktrees/<name>" — the
    // penultimate segment is "worktrees", so the old penultimate-only check
    // misclassified it as a worktree and silently dropped its content. The
    // segment before "worktrees" here is "modules", which is what
    // distinguishes this from a real worktree marker.
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: ../.git/modules/worktrees/foo\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("skips a worktree of a submodule (gitdir: .../modules/x/worktrees/y)", () => {
    // Regression lock: unlike the submodule-mounted-at-"worktrees" case
    // above, here "worktrees" is the checkout's OWN worktree segment (the
    // submodule is named "x", not "worktrees") — this is a real worktree,
    // just of a submodule instead of the main repo, and must still be
    // skipped like any other worktree.
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: ../.git/modules/x/worktrees/y\n");
    write(dir, "real.md", "Body");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["real.md"]
    );
  });

  it("walks a directory whose .git file has no gitdir: line (fails open)", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "not a real git file\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("walks a directory whose .git file has a gitdir: line that isn't the first line (fails open)", () => {
    // Git itself only ever writes the worktree marker with "gitdir: <path>"
    // as the file's first line. A malformed or coincidental file with a
    // gitdir-shaped line further down must not classify as a worktree.
    write(dir, "foo/c.md", "Body");
    writeFileSync(
      join(dir, "foo", ".git"),
      "not a marker\ngitdir: /elsewhere/.git/worktrees/wt1\n"
    );
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("walks a directory whose .git file exceeds the size cap (fails open, never reads it fully)", () => {
    write(dir, "foo/c.md", "Body");
    // A real worktree marker is a single short line. An oversized file named
    // `.git` (70KB, well past the 64KB cap) must not be read into memory —
    // it fails open and the directory is walked normally.
    const huge = `gitdir: /elsewhere/.git/worktrees/foo\n${"x".repeat(70_000)}`;
    writeFileSync(join(dir, "foo", ".git"), huge);
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("walks a directory whose .git file is missing the space after 'gitdir:' (fails open)", () => {
    // CodeRabbit round 3 on PR #31: git's read_gitfile_gently requires the
    // exact 8-byte prefix "gitdir: " (colon AND a space). A marker missing
    // the space is not one git wrote, so it must not classify as a
    // worktree.
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir:/elsewhere/.git/worktrees/wt1\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("walks a directory whose .git file has leading whitespace before 'gitdir:' (fails open)", () => {
    // Same rationale: git never writes leading whitespace before the
    // "gitdir: " prefix, so a line that has it isn't a marker git wrote.
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "  gitdir: /elsewhere/.git/worktrees/wt1\n");
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });

  it("emits no warning for a skipped worktree directory", () => {
    write(dir, "foo/c.md", "Body");
    writeFileSync(join(dir, "foo", ".git"), "gitdir: /elsewhere/.git/worktrees/foo\n");
    const warnings: string[] = [];
    readVaultFiles(dir, [".git", "node_modules"], (m) => warnings.push(m));
    assert.deepEqual(warnings, []);
  });

  it("still walks the vault root even when the root itself is a git worktree (.git file)", () => {
    write(dir, "root.md", "Body");
    write(dir, "sub/nested.md", "Body");
    writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/main\n");
    // Deliberately omit ".git" from skipDirs so the assertion proves the
    // vaultRoot exemption itself, not skipDirs pruning it.
    const files = readVaultFiles(dir, ["node_modules"], () => {});
    assert.deepEqual(files.map((f) => f.relPath).sort(), ["root.md", "sub/nested.md"]);
  });

  it("does not treat a directory as a worktree merely because it contains a .git directory (a real nested repo)", () => {
    write(dir, "foo/c.md", "Body");
    mkdirSync(join(dir, "foo", ".git"), { recursive: true });
    const files = readVaultFiles(dir, [".git", "node_modules"], () => {});
    assert.deepEqual(
      files.map((f) => f.relPath),
      ["foo/c.md"]
    );
  });
});
