import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Config {
  vaultRoot: string;
  backlogDir: string;
  archiveDir: string;
  statuses: string[];
  priorities: string[];
  defaultPriority: string;
  defaultStatus: string;
  archiveStatuses: string[];
  autoArchive: boolean;
  idStrategy: "sequential" | "timestamp" | "ulid";
  padWidth: number;
  slugMaxLength: number;
  project: {
    name: string;
    qualityCommand: string;
    testCommand: string;
    standardTags: string[];
  };
}

const DEFAULTS: Config = {
  vaultRoot: process.cwd(),
  backlogDir: "50-backlog",
  archiveDir: "archive",
  statuses: ["open", "in-progress", "done", "wont-do"],
  priorities: ["high", "medium", "low"],
  defaultPriority: "medium",
  defaultStatus: "open",
  archiveStatuses: ["done", "wont-do"],
  autoArchive: true,
  idStrategy: "sequential",
  padWidth: 4,
  slugMaxLength: 60,
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
  const root = dirname(dir) === dir ? dir : "/"; // filesystem root

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
 * Limitations: does not handle escaped quotes within strings (e.g. "path with \"quotes\"").
 * This is acceptable for a config file with a known, simple schema.
 */
export function parseToml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;
  let currentSectionPath: string[] = [];

  for (const rawLine of text.split("\n")) {
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
      } else if (!rawValue.startsWith("[")) {
        const commentIdx = rawValue.indexOf("#");
        if (commentIdx >= 0) {
          rawValue = rawValue.slice(0, commentIdx).trim();
        }
      }
      let value: unknown = rawValue;

      // Array: ["a", "b", "c"]
      const arrayMatch = (value as string).match(/^\[(.+)\]$/);
      if (arrayMatch) {
        value = arrayMatch[1]
          .split(",")
          .map((v) => v.trim().replace(/^["']|["']$/g, ""));
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
 * Load configuration by finding and parsing `.vault-tasks.toml`,
 * merged with defaults.
 */
export function loadConfig(startDir?: string): Config {
  const configFile = findConfigFile(startDir);

  if (!configFile) {
    return { ...DEFAULTS, vaultRoot: resolve(startDir ?? process.cwd()) };
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

  return {
    vaultRoot,
    backlogDir: resolve(vaultRoot, backlogRel),
    archiveDir: resolve(vaultRoot, backlogRel, archiveRel),
    statuses: (task["statuses"] as string[]) ?? DEFAULTS.statuses,
    priorities: (task["priorities"] as string[]) ?? DEFAULTS.priorities,
    defaultPriority: (task["default_priority"] as string) ?? DEFAULTS.defaultPriority,
    defaultStatus: (task["default_status"] as string) ?? DEFAULTS.defaultStatus,
    archiveStatuses: (task["archive_statuses"] as string[]) ?? DEFAULTS.archiveStatuses,
    autoArchive: (task["auto_archive"] as boolean) ?? DEFAULTS.autoArchive,
    idStrategy: (id["strategy"] as Config["idStrategy"]) ?? DEFAULTS.idStrategy,
    padWidth: (id["pad_width"] as number) ?? DEFAULTS.padWidth,
    slugMaxLength: (slug["max_length"] as number) ?? DEFAULTS.slugMaxLength,
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

[paths]
backlog_dir = "50-backlog"        # where task files live
archive_dir = "archive"           # relative to backlog_dir

[task]
# statuses = ["open", "in-progress", "done", "wont-do"]
# priorities = ["high", "medium", "low"]
# default_priority = "medium"
# default_status = "open"
# archive_statuses = ["done", "wont-do"]
# auto_archive = true

[id]
# strategy = "sequential"         # "sequential" | "timestamp" | "ulid"
# pad_width = 4                   # zero-pad width for sequential IDs

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
