import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import { TaskStore } from "../store.js";

export function cmdShow(config: Config, args: { identifier: string }): void {
  const store = new TaskStore(config);
  const task = store.find(args.identifier);
  console.log(readFileSync(task.filePath, "utf-8"));
}
