import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../config.js";
import { cmdInstallSkills } from "../commands/install-skills.js";

function makeConfig(vaultRoot: string): Config {
  return {
    vaultRoot,
    backlogDir: join(vaultRoot, "backlog"),
    archiveDir: join(vaultRoot, "backlog", "archive"),
    journalDir: join(vaultRoot, "journal"),
    projectsDir: join(vaultRoot, "projects"),
    evergreenDir: join(vaultRoot, "evergreen"),
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
      referenceDir: join(vaultRoot, "references"),
      referenceExclude: [],
      templateSourceDirs: [],
      templateSourceFiles: [],
      templatePatterns: [],
      skipDirs: [".git", "node_modules"],
      evergreenConventions: {
        requireFrontmatter: true,
        requireTitleField: true,
        requireTagsField: true,
        requireRelatedSection: true,
        requireBodyWikilink: true,
      },
      suggestionThreshold: 0.6,
    },
  };
}

function captureLogs(fn: () => void): { stdout: string; stderr: string } {
  const origLog = console.log;
  const origErr = console.error;
  let stdout = "";
  let stderr = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map(String).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    stderr += args.map(String).join(" ") + "\n";
  };
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { stdout, stderr };
}

describe("install-skills VAULT_TASKS_TEMPLATES_DIR override", () => {
  let vaultRoot: string;
  let templatesDir: string;
  const origEnv = process.env.VAULT_TASKS_TEMPLATES_DIR;

  beforeEach(() => {
    vaultRoot = mkdtempSync(join(tmpdir(), "vt-vault-"));
    templatesDir = mkdtempSync(join(tmpdir(), "vt-tpl-"));
    mkdirSync(join(templatesDir, "skills", "demo"), { recursive: true });
    writeFileSync(
      join(templatesDir, "skills", "demo", "SKILL.md"),
      "# demo skill from override path\n"
    );
    mkdirSync(join(templatesDir, "rules"), { recursive: true });
    writeFileSync(
      join(templatesDir, "rules", "demo.md"),
      "# demo rule from override path\n"
    );
    writeFileSync(
      join(templatesDir, "backlog.base"),
      "filters:\n  folder: '{{backlog_dir}}'\n"
    );
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.VAULT_TASKS_TEMPLATES_DIR;
    else process.env.VAULT_TASKS_TEMPLATES_DIR = origEnv;
  });

  it("--list reads from VAULT_TASKS_TEMPLATES_DIR when set", () => {
    process.env.VAULT_TASKS_TEMPLATES_DIR = templatesDir;
    const { stdout } = captureLogs(() => {
      cmdInstallSkills(makeConfig(vaultRoot), { list: true });
    });
    assert.match(stdout, /\[skill\] demo/);
    assert.match(stdout, /\[rule\] demo/);
    assert.match(stdout, /\[base\] backlog/);
  });

  it("--install copies templates from VAULT_TASKS_TEMPLATES_DIR", () => {
    process.env.VAULT_TASKS_TEMPLATES_DIR = templatesDir;
    captureLogs(() => {
      cmdInstallSkills(makeConfig(vaultRoot), { install: true });
    });
    const installedSkill = join(
      vaultRoot,
      ".claude",
      "skills",
      "demo",
      "SKILL.md"
    );
    assert.ok(existsSync(installedSkill), "skill should be installed in vault");
    assert.equal(
      readFileSync(installedSkill, "utf-8"),
      "# demo skill from override path\n"
    );
    const installedBase = join(vaultRoot, "backlog", "backlog.base");
    assert.ok(existsSync(installedBase), "base file should be installed");
    assert.match(readFileSync(installedBase, "utf-8"), /folder: 'backlog'/);
  });

  it("errors actionably when VAULT_TASKS_TEMPLATES_DIR points at a missing path", () => {
    const missing = join(tmpdir(), "vt-tpl-does-not-exist-" + Date.now());
    process.env.VAULT_TASKS_TEMPLATES_DIR = missing;
    assert.throws(
      () => {
        cmdInstallSkills(makeConfig(vaultRoot), { list: true });
      },
      (err: Error) => {
        assert.match(err.message, /VAULT_TASKS_TEMPLATES_DIR/);
        assert.ok(
          err.message.includes(missing),
          "error must include the offending path"
        );
        assert.match(err.message, /Unset it or point it/);
        return true;
      }
    );
  });
});
