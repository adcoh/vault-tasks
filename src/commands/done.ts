import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdDone(config: Config, args: { identifier: string }): void {
  const store = new TaskStore(config);
  const task = store.setStatus(args.identifier, "done");
  console.log(`${task.slug}.md: ${task.status === "done" ? "→ done" : task.status}`);
}
