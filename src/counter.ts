import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "./config.js";

/**
 * Scan backlog + archive directories for the highest numeric ID prefix.
 */
function scanMaxId(config: Config): number {
  let maxId = 0;

  for (const dir of [config.backlogDir, config.archiveDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const match = name.match(/^(\d+)-/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1], 10));
      }
    }
  }

  return maxId;
}

/**
 * Get the path to the shared git common dir (works across worktrees).
 */
function getGitCommonDir(cwd: string): string | null {
  try {
    const result = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return resolve(cwd, result.trim());
  } catch {
    return null;
  }
}

/**
 * Get the next sequential task ID.
 *
 * Uses a simple JSON counter file in the git common dir (shared across worktrees).
 * Falls back to file scanning if git is not available.
 * Always cross-checks against files to prevent collisions.
 *
 * Note: A race condition exists between reading and writing the counter file.
 * Two concurrent processes could get the same ID. This is handled safely by
 * TaskStore.create(), which uses exclusive file creation (wx flag) with retry
 * to detect and recover from collisions.
 */
function getNextSequentialId(config: Config): number {
  const fileMax = scanMaxId(config);
  const gitDir = getGitCommonDir(config.vaultRoot);

  if (!gitDir) {
    return fileMax + 1;
  }

  const counterPath = join(gitDir, "vault-tasks-counter.json");

  let storedNext = 0;
  try {
    const data = JSON.parse(readFileSync(counterPath, "utf-8"));
    storedNext = data.nextId ?? 0;
  } catch {
    // File doesn't exist or is corrupt
  }

  const nextId = Math.max(storedNext, fileMax + 1);

  try {
    writeFileSync(counterPath, JSON.stringify({ nextId: nextId + 1 }), "utf-8");
  } catch {
    // Best effort — if we can't write, the file scan fallback will still work
  }

  return nextId;
}

/**
 * Generate a timestamp-based ID: YYYYMMDD-HHMM
 */
function getTimestampId(): number {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ];
  return parseInt(parts.join(""), 10);
}

/**
 * Generate a ULID-like sortable ID (simplified: timestamp + random suffix).
 * Not a full ULID spec implementation, but collision-resistant and sortable.
 */
function getUlidId(): number {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  // Use last 10 digits of timestamp + 4 random digits
  return parseInt(`${timestamp % 10000000000}${String(random).padStart(4, "0")}`, 10);
}

/**
 * Get the next task ID based on the configured strategy.
 */
export function getNextId(config: Config): number {
  switch (config.idStrategy) {
    case "sequential":
      return getNextSequentialId(config);
    case "timestamp":
      return getTimestampId();
    case "ulid":
      return getUlidId();
    default:
      return getNextSequentialId(config);
  }
}

/**
 * Format an ID for use in filenames, respecting pad width.
 */
export function formatId(id: number, config: Config): string {
  if (config.idStrategy === "sequential") {
    return String(id).padStart(config.padWidth, "0");
  }
  // Timestamp and ULID IDs are already long enough
  return String(id);
}
