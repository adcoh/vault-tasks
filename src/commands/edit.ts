import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdEdit(
  config: Config,
  args: { identifier: string; status?: string; priority?: string; tags?: string }
): void {
  const store = new TaskStore(config);
  const tags = args.tags ? args.tags.split(",").map((t) => t.trim()) : undefined;
  const task = store.update(args.identifier, {
    status: args.status,
    priority: args.priority,
    tags,
  });
  console.log(`Updated: ${task.slug}.md`);
}
