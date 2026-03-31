import type { Config } from "../config.js";
import { formatTaskTable, sortByPriority } from "../output.js";
import { TaskStore } from "../store.js";

export function cmdList(
  config: Config,
  args: {
    status?: string;
    priority?: string;
    tag?: string;
    includeDone?: boolean;
  }
): void {
  const store = new TaskStore(config);
  let tasks = store.loadAll(args.includeDone);

  if (args.status) {
    tasks = tasks.filter((t) => t.status === args.status);
  } else if (!args.includeDone) {
    tasks = tasks.filter((t) => t.status === "open" || t.status === "in-progress");
  }

  if (args.priority) {
    tasks = tasks.filter((t) => t.priority === args.priority);
  }

  if (args.tag) {
    tasks = tasks.filter((t) => t.tags.includes(args.tag!));
  }

  console.log(formatTaskTable(sortByPriority(tasks)));
}
