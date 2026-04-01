import type { Config } from "../config.js";
import { formatTaskTable, sortByPriority } from "../output.js";
import { TaskStore } from "../store.js";

export function cmdSearch(
  config: Config,
  args: { keyword: string; all?: boolean }
): void {
  const store = new TaskStore(config);
  const matches = store.search(args.keyword, args.all);

  if (matches.length === 0) {
    console.log(`No tasks matching '${args.keyword}'.`);
    return;
  }

  console.log(formatTaskTable(sortByPriority(matches)));
}
