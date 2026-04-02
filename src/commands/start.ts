import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdStart(config: Config, args: { identifier: string }): void {
  const store = new TaskStore(config);
  const current = store.find(args.identifier);
  if (current.status === "in-progress") {
    console.log(`${current.slug}.md: already in-progress`);
    return;
  }
  const task = store.setStatus(args.identifier, "in-progress");
  console.log(`${task.slug}.md: ${current.status} → in-progress`);
}
