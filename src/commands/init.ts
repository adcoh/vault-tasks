import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateDefaultConfig } from "../config.js";

export function cmdInit(args: { dir?: string }): void {
  const root = resolve(args.dir ?? process.cwd());
  const configPath = join(root, ".vault-tasks.toml");
  const backlogDir = join(root, "50-backlog");

  if (existsSync(configPath)) {
    console.log(`.vault-tasks.toml already exists at ${configPath}`);
    return;
  }

  writeFileSync(configPath, generateDefaultConfig(), "utf-8");
  console.log(`Created: .vault-tasks.toml`);

  if (!existsSync(backlogDir)) {
    mkdirSync(backlogDir, { recursive: true });
    console.log(`Created: 50-backlog/`);
  }

  // Ensure .vault-tasks-counter.json is gitignored
  const gitignorePath = join(root, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".vault-tasks-counter.json")) {
      writeFileSync(gitignorePath, content.trimEnd() + "\n.vault-tasks-counter.json\n", "utf-8");
      console.log("Updated: .gitignore (added .vault-tasks-counter.json)");
    }
  } else {
    writeFileSync(gitignorePath, ".vault-tasks-counter.json\n", "utf-8");
    console.log("Created: .gitignore");
  }

  console.log("\nvault-tasks initialized. Create your first task with:");
  console.log('  vt new "My first task"');
}
