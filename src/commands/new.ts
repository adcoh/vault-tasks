import { execFileSync } from "node:child_process";
import type { Config } from "../config.js";
import { similarity } from "../similarity.js";
import { TaskStore } from "../store.js";

export function cmdNew(
  config: Config,
  args: {
    title: string;
    priority?: string;
    tags?: string;
    source?: string;
    commit?: boolean;
    noDedupe?: boolean;
  }
): void {
  const store = new TaskStore(config);
  const tags = args.tags
    ? args.tags.split(",").map((t) => t.trim())
    : [];

  // Check for similar existing tasks before creating. Bounded by
  // `dedupeScanLimit` so large archives don't turn every `vt new` into an
  // O(N) disk walk.
  if (!args.noDedupe) {
    const existing = store.loadRecent(config.dedupeScanLimit, true);
    const similar: Array<{ title: string; id: string; score: number }> = [];

    for (const task of existing) {
      const score = similarity(args.title, task.title);
      if (score >= config.dedupeThreshold) {
        similar.push({ title: task.title, id: task.id, score });
      }
    }

    if (similar.length > 0) {
      similar.sort((a, b) => b.score - a.score);
      console.error("Warning: Similar tasks found:");
      for (const { title, id, score } of similar) {
        const pct = Math.round(score * 100);
        console.error(`  [${id}] ${title} (${pct}% similar)`);
      }
      console.error("Creating anyway. Use --no-dedupe to suppress this check.\n");
    }
  }

  const task = store.create({
    title: args.title,
    priority: args.priority,
    tags,
    source: args.source,
  });

  console.log(`Created: ${store.relativePath(task.filePath)}`);

  if (args.commit) {
    try {
      execFileSync("git", ["add", "--", task.filePath], {
        cwd: config.vaultRoot,
        stdio: "inherit",
      });
      const truncatedTitle = task.title.length > 72 ? task.title.slice(0, 69) + "..." : task.title;
      execFileSync("git", ["commit", "-m", `chore: add backlog task — ${truncatedTitle}`], {
        cwd: config.vaultRoot,
        stdio: "inherit",
      });
      console.log("Committed.");
    } catch {
      console.error("Git commit failed.");
      process.exitCode = 1;
    }
  }
}
