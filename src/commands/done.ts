import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdDone(config: Config, args: { identifier: string }): void {
  const store = new TaskStore(config);
  const task = store.setStatus(args.identifier, "done");
  const archived = task.filePath.startsWith(config.archiveDir);
  console.log(`${task.slug}.md → done${archived ? " (archived)" : ""}`);
}
