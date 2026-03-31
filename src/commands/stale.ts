import type { Config } from "../config.js";
import { formatStaleTable } from "../output.js";
import { TaskStore } from "../store.js";

export function cmdStale(config: Config, args: { days?: number }): void {
  const store = new TaskStore(config);
  const items = store.stale(args.days ?? 14);
  console.log(formatStaleTable(items));
}
