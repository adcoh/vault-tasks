import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

  console.log("\nvault-tasks initialized. Create your first task with:");
  console.log('  vt new "My first task"');
}
