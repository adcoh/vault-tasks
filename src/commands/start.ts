import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdStart(config: Config, args: { identifier: string }): void {
  const store = new TaskStore(config);
  const task = store.setStatus(args.identifier, "in-progress");
  console.log(`${task.slug}.md: → in-progress`);
}
