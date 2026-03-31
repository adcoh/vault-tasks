import { execSync } from "node:child_process";
import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdNew(
  config: Config,
  args: {
    title: string;
    priority?: string;
    tags?: string;
    source?: string;
    commit?: boolean;
  }
): void {
  const store = new TaskStore(config);
  const tags = args.tags
    ? args.tags.split(",").map((t) => t.trim())
    : [];

  const task = store.create({
    title: args.title,
    priority: args.priority,
    tags,
    source: args.source,
  });

  console.log(`Created: ${store.relativePath(task.filePath)}`);

  if (args.commit) {
    try {
      execSync(`git add "${task.filePath}"`, {
        cwd: config.vaultRoot,
        stdio: "inherit",
      });
      execSync(
        `git commit -m "chore: add backlog task — ${task.title}"`,
        { cwd: config.vaultRoot, stdio: "inherit" }
      );
      console.log("Committed.");
    } catch {
      console.error("Git commit failed.");
      process.exitCode = 1;
    }
  }
}
