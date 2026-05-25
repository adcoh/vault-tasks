import type { Task } from "../task.js";

export type SearchMode = "keyword" | "bm25" | "semantic" | "hybrid";

export interface SearchHit {
  task: Task;
  score: number;
  mode: SearchMode;
}

export interface SearchOptions {
  mode?: SearchMode;
  limit?: number;
  includeArchived?: boolean;
}
