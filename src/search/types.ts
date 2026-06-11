import type { Task } from "../task.js";
import type { Embedder } from "./embeddings.js";

/**
 * Search modes:
 *  - `keyword` — substring match (the CLI's legacy default), priority-sorted.
 *  - `bm25`    — lexical relevance ranking. Fully offline.
 *  - `semantic`— vector similarity via an embedding engine (local by default).
 *  - `hybrid`  — `bm25` + `semantic` fused with Reciprocal Rank Fusion.
 *
 * `semantic` and `hybrid` require an embedding engine (see search/embeddings.ts);
 * `keyword` and `bm25` need no network.
 */
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
  /**
   * Embedding backend for `semantic`/`hybrid`. When omitted, one is built from
   * config. Injected by tests to avoid any network/model dependency.
   */
  embedder?: Embedder;
}
