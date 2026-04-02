import { randomInt } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
        const parsed = parseInt(match[1], 10);
        if (Number.isSafeInteger(parsed)) {
          maxId = Math.max(maxId, parsed);
        }
      }
    }
  }

  return maxId;
}

/**
 * Get the next sequential task ID.
 *
 * Uses a simple JSON counter file in the vault root.
 * Falls back to file scanning if the counter file is missing or corrupt.
 * Always cross-checks against files to prevent collisions.
 *
 * Note: A race condition exists between reading and writing the counter file.
 * Two concurrent processes could get the same ID. This is handled safely by
 * TaskStore.create(), which uses exclusive file creation (wx flag) with retry
 * to detect and recover from collisions.
 */
function getNextSequentialId(config: Config): number {
  const fileMax = scanMaxId(config);
  const counterPath = join(config.vaultRoot, ".vault-tasks-counter.json");

  let storedNext = 0;
  try {
    const data = JSON.parse(readFileSync(counterPath, "utf-8"));
    storedNext = data.nextId ?? 0;
  } catch {
    // File doesn't exist or is corrupt — fall back to file scan
  }

  const nextId = Math.max(storedNext, fileMax + 1);

  try {
    writeFileSync(counterPath, JSON.stringify({ nextId: nextId + 1 }), "utf-8");
  } catch {
    // Best effort — file scan fallback will still work
  }

  return nextId;
}

/**
 * Generate a timestamp-based ID: YYYYMMDDHHMMss
 */
function getTimestampId(): number {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return parseInt(parts.join(""), 10);
}

/**
 * Generate a ULID-like sortable ID (simplified: timestamp + random suffix).
 * Not a full ULID spec implementation, but collision-resistant and sortable.
 * Uses crypto.randomInt() for better randomness and validates safe integer range.
 */
function getUlidId(): number {
  // Use last 7 digits of timestamp (covers ~115 days) + 6 random digits = 13 digits max.
  // Number.MAX_SAFE_INTEGER is 9007199254740991 (16 digits), so 13 digits is always safe.
  // Retry loop guards against any edge case where the result is not a safe integer.
  for (let attempt = 0; attempt < 10; attempt++) {
    const timestamp = Date.now() % 10000000; // 7 digits
    const random = randomInt(0, 1000000); // 6 digits: 0–999999
    const id = parseInt(`${timestamp}${String(random).padStart(6, "0")}`, 10);
    if (Number.isSafeInteger(id)) {
      return id;
    }
  }
  // Fallback: should never reach here, but return a safe value if it does
  return Date.now() % 10000000000;
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
