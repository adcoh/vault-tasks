import type { Task } from "../task.js";
import type { TaskStore } from "../store.js";
import { BM25Index } from "./bm25.js";
import { tokenize } from "./tokenize.js";
import type { SearchHit, SearchMode, SearchOptions } from "./types.js";

export type { SearchHit, SearchMode, SearchOptions } from "./types.js";
export { BM25Index } from "./bm25.js";
export { tokenize } from "./tokenize.js";

const DEFAULT_LIMIT = 20;

function unsupported(mode: SearchMode): never {
  throw new Error(
    `Search mode '${mode}' is not available in this release. ` +
    `BM25 is the only ranked mode currently shipped; semantic and hybrid modes are planned.`
  );
}

function resolveLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return n;
}

/**
 * Free-text query search across the task corpus.
 *
 * The `keyword` mode is delegated to `TaskStore.search()` (preserved for
 * backwards-compatibility with the existing CLI) and returns substring matches
 * scored 1.0 in document order. Use `bm25` for ranked results.
 */
export async function searchTasks(
  store: TaskStore,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const mode = opts.mode ?? "bm25";
  const limit = resolveLimit(opts.limit);
  const includeArchived = opts.includeArchived ?? false;

  if (mode === "keyword") {
    const matches = store.search(query, includeArchived).slice(0, limit);
    return matches.map((task) => ({ task, score: 1, mode: "keyword" as const }));
  }

  if (mode === "bm25") {
    const tasks = store.loadAll(includeArchived);
    if (tasks.length === 0) return [];
    const index = new BM25Index(tasks);
    return index.query(query, limit);
  }

  return unsupported(mode);
}

/**
 * Find tasks similar to a given target. The target task itself is excluded
 * from results. The query is built from the target's title and tags only —
 * including the body tends to dilute the signal on long-bodied tasks without
 * adding much precision.
 */
export async function similarTasks(
  store: TaskStore,
  target: Task,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const mode = opts.mode ?? "bm25";
  const limit = resolveLimit(opts.limit);
  const includeArchived = opts.includeArchived ?? false;

  if (mode === "bm25") {
    const all = store.loadAll(includeArchived);
    const corpus = all.filter((t) => t.filePath !== target.filePath);
    if (corpus.length === 0) return [];
    const queryText = `${target.title} ${target.tags.join(" ")}`;
    const queryTokens = tokenize(queryText);
    if (queryTokens.length === 0) return [];
    const index = new BM25Index(corpus);
    return index.queryTokens(queryTokens, limit);
  }

  return unsupported(mode);
}
