import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { generateDefaultConfig, loadConfig } from "../config.js";

const COUNTER_IGNORE_LINE = ".vault-tasks-counter.json";

/**
 * Atomically ensure `.vault-tasks-counter.json` is listed in .gitignore.
 *
 * Uses `openSync(path, 'wx')` to create the file exclusively; on EEXIST we
 * read and append only if the line is missing. This avoids the TOCTOU race
 * between `existsSync` and `writeFileSync` and guarantees we never overwrite
 * an existing `.gitignore`.
 */
function ensureCounterIgnored(gitignorePath: string): void {
  try {
    const fd = openSync(gitignorePath, "wx");
    try {
      writeFileSync(fd, `${COUNTER_IGNORE_LINE}\n`, "utf-8");
    } finally {
      closeSync(fd);
    }
    console.log("Created: .gitignore");
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const content = readFileSync(gitignorePath, "utf-8");
  // Line-level match so we don't get fooled by "#.vault-tasks-counter.json" in a comment.
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(COUNTER_IGNORE_LINE)) return;

  const appended = content.endsWith("\n") ? content : content + "\n";
  writeFileSync(gitignorePath, appended + `${COUNTER_IGNORE_LINE}\n`, "utf-8");
  console.log(`Updated: .gitignore (added ${COUNTER_IGNORE_LINE})`);
}

export function cmdInit(args: { dir?: string }): void {
  const root = resolve(args.dir ?? process.cwd());
  const configPath = join(root, ".vault-tasks.toml");
  const backlogDir = join(root, "backlog");

  if (existsSync(configPath)) {
    console.log(`.vault-tasks.toml already exists at ${configPath}`);
    return;
  }

  writeFileSync(configPath, generateDefaultConfig(), "utf-8");
  console.log(`Created: .vault-tasks.toml`);

  const backlogExisted = existsSync(backlogDir);
  mkdirSync(backlogDir, { recursive: true });
  if (!backlogExisted) console.log(`Created: backlog/`);

  // Only add counter file to .gitignore for sequential ID strategy
  const config = loadConfig(root);
  if (config.idStrategy === "sequential") {
    ensureCounterIgnored(join(root, ".gitignore"));
  }

  console.log("\nvault-tasks initialized. Create your first task with:");
  console.log('  vt new "My first task"');
}
