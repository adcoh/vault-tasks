import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdEdit(
  config: Config,
  args: { identifier: string; status?: string; priority?: string }
): void {
  const store = new TaskStore(config);
  const task = store.update(args.identifier, {
    status: args.status,
    priority: args.priority,
  });
  console.log(`Updated: ${task.slug}.md`);
}
