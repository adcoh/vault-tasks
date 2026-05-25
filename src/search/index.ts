import type { Task } from "../task.js";
import type { TaskStore } from "../store.js";
import { sortByPriority } from "../output.js";
import { BM25Index } from "./bm25.js";
import { tokenize } from "./tokenize.js";
import type { SearchHit, SearchMode, SearchOptions } from "./types.js";

export type { SearchHit, SearchMode, SearchOptions } from "./types.js";
export { BM25Index } from "./bm25.js";
export { tokenize } from "./tokenize.js";

const DEFAULT_LIMIT = 20;

function resolveLimit(limit: number | undefined): number {
  const n = limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return n;
}

function assertExhaustive(x: never): never {
  throw new Error(`Unhandled search mode: ${x as string}`);
}

/**
 * Free-text query search across the task corpus.
 *
 * Modes:
 *  - `keyword` (default): substring match on title, body, AND tags, ordered by
 *    priority. Matches the CLI's default behavior so the two surfaces agree.
 *  - `bm25`: ranked relevance scoring across title + tags + body.
 *
 * `limit` defaults to 20 across all modes.
 */
export async function searchTasks(
  store: TaskStore,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const mode = opts.mode ?? "keyword";
  const limit = resolveLimit(opts.limit);
  const includeArchived = opts.includeArchived ?? false;

  if (mode === "keyword") {
    const matches = store.search(query, includeArchived);
    const ranked = sortByPriority(matches).slice(0, limit);
    return ranked.map((task) => ({ task, score: 1, mode: "keyword" as const }));
  }

  if (mode === "bm25") {
    const tasks = store.loadAll(includeArchived);
    if (tasks.length === 0) return [];
    const index = new BM25Index(tasks);
    return index.query(query, limit);
  }

  return assertExhaustive(mode);
}

/**
 * Find tasks similar to a given target, excluding the target itself.
 *
 * The query is built from the target's title and tags only — the body tends
 * to dilute the similarity signal on long-bodied tasks without adding much
 * precision.
 */
export async function similarTasks(
  store: TaskStore,
  target: Task,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const mode = opts.mode ?? "bm25";
  const limit = resolveLimit(opts.limit);
  const includeArchived = opts.includeArchived ?? false;

  if (mode === "keyword") {
    // Similarity in keyword mode is the union of substring hits for the
    // target's title and each tag, excluding the target itself, priority-sorted.
    const queries = [target.title, ...target.tags].filter((s) => s.length > 0);
    if (queries.length === 0) return [];
    const seen = new Set<string>();
    const matches: Task[] = [];
    for (const q of queries) {
      for (const t of store.search(q, includeArchived)) {
        if (t.filePath === target.filePath) continue;
        if (seen.has(t.filePath)) continue;
        seen.add(t.filePath);
        matches.push(t);
      }
    }
    const ranked = sortByPriority(matches).slice(0, limit);
    return ranked.map((task) => ({ task, score: 1, mode: "keyword" as const }));
  }

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

  return assertExhaustive(mode);
}
