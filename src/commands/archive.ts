import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdArchive(config: Config): void {
  const store = new TaskStore(config);
  const archived = store.archiveCompleted();

  if (archived.length === 0) {
    console.log("No completed tasks to archive.");
    return;
  }

  for (const task of archived) {
    console.log(`  Archived: ${task.slug}.md`);
  }
  console.log(`\n${archived.length} task(s) archived.`);
}
