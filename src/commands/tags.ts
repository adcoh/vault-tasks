import type { Config } from "../config.js";
import { formatTagList } from "../output.js";
import { TaskStore } from "../store.js";

export function cmdTags(config: Config): void {
  const store = new TaskStore(config);
  const tags = store.allTags();
  console.log(formatTagList(tags));
}
