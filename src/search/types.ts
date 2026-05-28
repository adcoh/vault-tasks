import type { Task } from "../task.js";

/**
 * Search modes available in this release. `'semantic'` and `'hybrid'` are
 * planned but not yet implemented; they are deliberately omitted from this
 * union so attempts to use them fail at compile time rather than producing a
 * surprise runtime error.
 */
export type SearchMode = "keyword" | "bm25";

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
