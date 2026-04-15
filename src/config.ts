import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const ID_STRATEGIES = ["sequential", "timestamp", "ulid"] as const;
export type IdStrategy = (typeof ID_STRATEGIES)[number];

export interface Config {
  vaultRoot: string;
  backlogDir: string;
  archiveDir: string;
  journalDir: string;
  projectsDir: string;
  evergreenDir: string;
  statuses: string[];
  priorities: string[];
  defaultPriority: string;
  defaultStatus: string;
  archiveStatuses: string[];
  autoArchive: boolean;
  idStrategy: IdStrategy;
  padWidth: number;
  slugMaxLength: number;
  dedupeThreshold: number;
  dedupeScanLimit: number;
  project: {
    name: string;
    qualityCommand: string;
    testCommand: string;
    standardTags: string[];
  };
}

const DEFAULTS: Config = {
  vaultRoot: process.cwd(),
  backlogDir: "backlog",
  archiveDir: "archive",
  journalDir: "journal",
  projectsDir: "projects",
  evergreenDir: "evergreen",
  statuses: ["open", "in-progress", "done", "wont-do"],
  priorities: ["high", "medium", "low"],
  defaultPriority: "medium",
  defaultStatus: "open",
  archiveStatuses: ["done", "wont-do"],
  autoArchive: true,
  idStrategy: "ulid",
  padWidth: 4,
  slugMaxLength: 60,
  dedupeThreshold: 0.5,
  dedupeScanLimit: 500,
  project: {
    name: "",
    qualityCommand: "",
    testCommand: "",
    standardTags: [],
  },
};

const CONFIG_FILENAME = ".vault-tasks.toml";

/**
 * Walk up from `startDir` looking for `.vault-tasks.toml`.
 * Returns the path to the config file, or null if not found.
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);

  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Minimal TOML parser for the subset we use.
 * Handles: string values, arrays of strings, nested tables via [section.subsection].
 *
 * Limitations:
 * - Does not handle escaped quotes within strings (e.g. "path with \"quotes\"").
 * - Multi-line arrays are not supported; arrays must be on a single line.
 * This is acceptable for a config file with a known, simple schema.
 */
export function parseToml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;
  let currentSectionPath: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Section header: [paths] or [project.tags]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = sectionMatch[1].split(".");
      currentSectionPath = parts;

      // Navigate/create nested objects
      let target = result;
      for (const part of parts) {
        if (!(part in target) || typeof target[part] !== "object" || Array.isArray(target[part])) {
          target[part] = {};
        }
        target = target[part] as Record<string, unknown>;
      }
      currentSection = target;
      continue;
    }

    // Key = value (strip inline comments: `key = "value" # comment`)
    const kvMatch = line.match(/^(\w[\w-]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let rawValue = kvMatch[2].trim();

      // Strip inline comments
      // For quoted values: find closing quote, then strip comment after it
      if (rawValue.startsWith('"')) {
        const closeQuote = rawValue.indexOf('"', 1);
        if (closeQuote >= 0) {
          rawValue = rawValue.slice(0, closeQuote + 1).trim();
        }
      } else if (rawValue.startsWith("'")) {
        const closeQuote = rawValue.indexOf("'", 1);
        if (closeQuote >= 0) {
          rawValue = rawValue.slice(0, closeQuote + 1).trim();
        }
      } else if (rawValue.startsWith("[")) {
        // Array value: find the real closing bracket, ignoring trailing comments
        const closeBracket = rawValue.lastIndexOf("]");
        if (closeBracket < 0) {
          throw new Error(
            `Multi-line arrays are not supported. ` +
            `Key "${key}" has an opening "[" but no closing "]" on the same line. ` +
            `Please use single-line arrays, e.g.: ${key} = ["a", "b"]`
          );
        }
        rawValue = rawValue.slice(0, closeBracket + 1).trim();
      } else {
        const commentIdx = rawValue.indexOf("#");
        if (commentIdx >= 0) {
          rawValue = rawValue.slice(0, commentIdx).trim();
        }
      }
      let value: unknown = rawValue;

      // Array: ["a", "b", "c"] or []
      const arrayMatch = (value as string).match(/^\[(.*)\]$/);
      if (arrayMatch) {
        const inner = arrayMatch[1].trim();
        if (inner === "") {
          value = [];
        } else {
          value = inner
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""));
        }
      }
      // Boolean
      else if (value === "true") value = true;
      else if (value === "false") value = false;
      // Number
      else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
      // String (strip quotes)
      else value = (value as string).replace(/^["']|["']$/g, "");

      currentSection[key] = value;
    }
  }

  return result;
}

/**
 * Probe a backlog dir for legacy sequential IDs. Returns the widest zero-padded
 * numeric prefix (pad width) if sequential-style files exist, else null.
 *
 * Used to keep existing 0.1.x vaults on the sequential strategy when no config
 * file is present, rather than silently mixing ULID files alongside NNNN files.
 */
function detectLegacySequentialWidth(backlogDir: string): number | null {
  if (!existsSync(backlogDir)) return null;
  let widest = 0;
  let found = false;
  for (const name of readdirSync(backlogDir)) {
    const m = name.match(/^(\d+)-.*\.md$/);
    if (!m) continue;
    found = true;
    if (m[1].length > widest) widest = m[1].length;
  }
  return found ? widest : null;
}

/**
 * Load configuration by finding and parsing `.vault-tasks.toml`,
 * merged with defaults.
 */
export function loadConfig(startDir?: string): Config {
  const configFile = findConfigFile(startDir);

  if (!configFile) {
    const vaultRoot = resolve(startDir ?? process.cwd());
    const backlogDir = resolve(vaultRoot, DEFAULTS.backlogDir);
    // Keep legacy vaults (upgraded from 0.1.x without a config) on sequential
    // so `vt new` keeps producing NNNN-* filenames instead of silently mixing
    // ULIDs with the user's existing numbered tasks.
    const legacyWidth = detectLegacySequentialWidth(backlogDir);
    return {
      ...DEFAULTS,
      vaultRoot,
      backlogDir,
      archiveDir: resolve(vaultRoot, DEFAULTS.backlogDir, DEFAULTS.archiveDir),
      journalDir: resolve(vaultRoot, DEFAULTS.journalDir),
      projectsDir: resolve(vaultRoot, DEFAULTS.projectsDir),
      evergreenDir: resolve(vaultRoot, DEFAULTS.evergreenDir),
      idStrategy: legacyWidth !== null ? "sequential" : DEFAULTS.idStrategy,
      padWidth: legacyWidth !== null ? Math.max(legacyWidth, DEFAULTS.padWidth) : DEFAULTS.padWidth,
    };
  }

  const raw = readFileSync(configFile, "utf-8");
  const parsed = parseToml(raw);
  const vaultRoot = dirname(configFile);

  const paths = (parsed["paths"] ?? {}) as Record<string, unknown>;
  const task = (parsed["task"] ?? {}) as Record<string, unknown>;
  const id = (parsed["id"] ?? {}) as Record<string, unknown>;
  const slug = (parsed["slugify"] ?? {}) as Record<string, unknown>;
  const project = (parsed["project"] ?? {}) as Record<string, unknown>;
  const projectTags = (project["tags"] ?? {}) as Record<string, unknown>;

  const backlogRel = (paths["backlog_dir"] as string) ?? DEFAULTS.backlogDir;
  const archiveRel = (paths["archive_dir"] as string) ?? DEFAULTS.archiveDir;
  const journalRel = (paths["journal_dir"] as string) ?? DEFAULTS.journalDir;
  const projectsRel = (paths["projects_dir"] as string) ?? DEFAULTS.projectsDir;
  const evergreenRel = (paths["evergreen_dir"] as string) ?? DEFAULTS.evergreenDir;

  const backlogDir = resolve(vaultRoot, backlogRel);
  const archiveDir = resolve(vaultRoot, backlogRel, archiveRel);
  const journalDir = resolve(vaultRoot, journalRel);
  const projectsDir = resolve(vaultRoot, projectsRel);
  const evergreenDir = resolve(vaultRoot, evergreenRel);

  // Path traversal validation: ensure directories stay inside vault root
  const pathChecks: [string, string][] = [
    [backlogDir, "backlog_dir"],
    [archiveDir, "archive_dir"],
    [journalDir, "journal_dir"],
    [projectsDir, "projects_dir"],
    [evergreenDir, "evergreen_dir"],
  ];
  for (const [absPath, name] of pathChecks) {
    if (relative(vaultRoot, absPath).startsWith("..")) {
      throw new Error(`${name} must be inside the vault root`);
    }
  }

  const rawStrategy = id["strategy"];
  let idStrategy: IdStrategy;
  let inferredPadWidth: number | null = null;
  if (rawStrategy !== undefined) {
    if (typeof rawStrategy !== "string" || !(ID_STRATEGIES as readonly string[]).includes(rawStrategy)) {
      throw new Error(
        `Invalid [id] strategy: ${JSON.stringify(rawStrategy)}. ` +
        `Must be one of: ${ID_STRATEGIES.join(", ")}. ` +
        `Edit ${configFile} to fix.`
      );
    }
    idStrategy = rawStrategy as IdStrategy;
  } else {
    // No explicit strategy. Mirror the no-config-file branch: if existing
    // NNNN-*.md files are present, stay on sequential to avoid silently
    // mixing ULIDs into a vault that was running on 0.1.x defaults.
    const legacyWidth = detectLegacySequentialWidth(backlogDir);
    if (legacyWidth !== null) {
      idStrategy = "sequential";
      inferredPadWidth = legacyWidth;
    } else {
      idStrategy = DEFAULTS.idStrategy;
    }
  }

  const rawThreshold = task["dedupe_threshold"];
  let dedupeThreshold = DEFAULTS.dedupeThreshold;
  if (rawThreshold !== undefined) {
    const n = typeof rawThreshold === "number" ? rawThreshold : Number(rawThreshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(
        `Invalid [task] dedupe_threshold: ${JSON.stringify(rawThreshold)}. ` +
        `Must be a number between 0 and 1.`
      );
    }
    dedupeThreshold = n;
  }

  const rawScanLimit = task["dedupe_scan_limit"];
  let dedupeScanLimit = DEFAULTS.dedupeScanLimit;
  if (rawScanLimit !== undefined) {
    const n = typeof rawScanLimit === "number" ? rawScanLimit : Number(rawScanLimit);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Invalid [task] dedupe_scan_limit: ${JSON.stringify(rawScanLimit)}. ` +
        `Must be a non-negative integer.`
      );
    }
    dedupeScanLimit = n;
  }

  return {
    vaultRoot,
    backlogDir,
    archiveDir,
    journalDir,
    projectsDir,
    evergreenDir,
    statuses: (task["statuses"] as string[]) ?? DEFAULTS.statuses,
    priorities: (task["priorities"] as string[]) ?? DEFAULTS.priorities,
    defaultPriority: (task["default_priority"] as string) ?? DEFAULTS.defaultPriority,
    defaultStatus: (task["default_status"] as string) ?? DEFAULTS.defaultStatus,
    archiveStatuses: (task["archive_statuses"] as string[]) ?? DEFAULTS.archiveStatuses,
    autoArchive: (task["auto_archive"] as boolean) ?? DEFAULTS.autoArchive,
    idStrategy,
    padWidth:
      (id["pad_width"] as number) ??
      (inferredPadWidth !== null ? Math.max(inferredPadWidth, DEFAULTS.padWidth) : DEFAULTS.padWidth),
    slugMaxLength: (slug["max_length"] as number) ?? DEFAULTS.slugMaxLength,
    dedupeThreshold,
    dedupeScanLimit,
    project: {
      name: (project["name"] as string) ?? "",
      qualityCommand: (project["quality_command"] as string) ?? "",
      testCommand: (project["test_command"] as string) ?? "",
      standardTags: (projectTags["standard"] as string[]) ?? [],
    },
  };
}

/**
 * Generate a default `.vault-tasks.toml` with commented documentation.
 */
export function generateDefaultConfig(): string {
  return `# vault-tasks configuration
# Place this file at your vault/repo root.
# All paths are relative to this file's directory.
# Note: arrays must be on a single line

[paths]
backlog_dir = "backlog"           # where task files live
archive_dir = "archive"           # relative to backlog_dir
# journal_dir = "journal"         # build logs and session notes
# projects_dir = "projects"       # project folders with CONTEXT.md
# evergreen_dir = "evergreen"     # evergreen/zettelkasten notes

[task]
# statuses = ["open", "in-progress", "done", "wont-do"]
# priorities = ["high", "medium", "low"]
# default_priority = "medium"
# default_status = "open"
# archive_statuses = ["done", "wont-do"]
# auto_archive = true
# dedupe_threshold = 0.5            # similarity 0..1 for duplicate warnings on vt new
# dedupe_scan_limit = 500           # most-recent N tasks scanned for duplicates (0 = unlimited)

[id]
# strategy = "ulid"               # "ulid" | "sequential" | "timestamp"
# pad_width = 4                   # zero-pad width (only used with sequential)

[slugify]
# max_length = 60

# [project]
# name = ""
# quality_command = ""
# test_command = ""

# [project.tags]
# standard = []
`;
}
