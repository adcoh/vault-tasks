import type { Task } from "../task.js";
import type { TaskStore } from "../store.js";
import { sortByPriority } from "../output.js";
import { BM25Index } from "./bm25.js";
import { EmbedCache } from "./embed-cache.js";
import { createEmbedder } from "./embeddings.js";
import type { Embedder } from "./embeddings.js";
import { tokenize } from "./tokenize.js";
import type { SearchHit, SearchMode, SearchOptions } from "./types.js";
import { VectorIndex } from "./vector-store.js";

export type { SearchHit, SearchMode, SearchOptions } from "./types.js";
export type { Embedder } from "./embeddings.js";
export { BM25Index } from "./bm25.js";
export { VectorIndex } from "./vector-store.js";
export { EmbedCache } from "./embed-cache.js";
export { createEmbedder } from "./embeddings.js";
export { EMBEDDING_PROVIDERS } from "../config.js";
export type { EmbeddingProvider } from "../config.js";
export { tokenize } from "./tokenize.js";

const DEFAULT_LIMIT = 20;

// Reciprocal Rank Fusion constant. 60 is the value from the original Cormack
// et al. paper and the de-facto default — it damps the contribution of any
// single list's top ranks enough that one engine can't dominate the fusion.
const RRF_K = 60;

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

function buildEmbedder(store: TaskStore, opts: SearchOptions): Embedder {
  return opts.embedder ?? createEmbedder(store.config.search);
}

function buildCache(store: TaskStore, embedder: Embedder): EmbedCache {
  return new EmbedCache(
    store.config.vaultRoot,
    embedder.provider,
    embedder.model,
    store.config.search.embeddingDimensions
  );
}

/**
 * Fuse ranked lists with Reciprocal Rank Fusion: each task accumulates
 * `1 / (RRF_K + rank)` (1-based rank) across every list it appears in. Tasks are
 * keyed by file path. The result carries `mode: "hybrid"` and the fused score.
 */
function rrfFuse(lists: SearchHit[][], limit: number): SearchHit[] {
  const scores = new Map<string, number>();
  const taskByKey = new Map<string, Task>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const hit = list[rank];
      const key = hit.task.filePath;
      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
      taskByKey.set(key, hit.task);
    }
  }
  const fused: SearchHit[] = [];
  for (const [key, score] of scores) {
    const task = taskByKey.get(key);
    if (task) fused.push({ task, score, mode: "hybrid" });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}

/**
 * Free-text query search across the task corpus.
 *
 * Modes:
 *  - `keyword` (default): substring match on title, body, AND tags, ordered by
 *    priority. Matches the CLI's default behavior so the two surfaces agree.
 *  - `bm25`: ranked relevance scoring across title + tags + body.
 *  - `semantic`: cosine similarity over embeddings of the query and corpus.
 *  - `hybrid`: `bm25` and `semantic` fused with Reciprocal Rank Fusion.
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

  if (mode === "semantic" || mode === "hybrid") {
    const tasks = store.loadAll(includeArchived);
    if (tasks.length === 0) return [];
    const embedder = buildEmbedder(store, opts);
    const embedded = await buildCache(store, embedder).getOrCompute(tasks, embedder);
    const queryVec = (await embedder.embed([query]))[0];
    const vindex = new VectorIndex(embedded);
    const semHits = vindex.query(queryVec, mode === "semantic" ? limit : tasks.length);

    if (mode === "semantic") return semHits;

    const bmHits = new BM25Index(tasks).query(query, tasks.length);
    return rrfFuse([bmHits, semHits], limit);
  }

  return assertExhaustive(mode);
}

/**
 * Find tasks similar to a given target, excluding the target itself.
 *
 * In lexical modes the query is built from the target's title and tags only —
 * the body tends to dilute the signal. In `semantic`/`hybrid` modes the target's
 * own document embedding (already cached) is the query vector.
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

  if (mode === "semantic" || mode === "hybrid") {
    const all = store.loadAll(includeArchived);
    const embedder = buildEmbedder(store, opts);
    const embedded = await buildCache(store, embedder).getOrCompute(all, embedder);

    const targetEntry = embedded.find((e) => e.task.filePath === target.filePath);
    const corpus = embedded.filter((e) => e.task.filePath !== target.filePath);
    if (corpus.length === 0) return [];

    // Prefer the target's cached document vector. It is absent only when the
    // target lives outside the loaded scope (e.g. an archived target with
    // includeArchived=false) — then embed its text directly.
    const queryVec = targetEntry
      ? targetEntry.vector
      : (await embedder.embed([`${target.title}\n${target.tags.join(" ")}\n${target.body}`]))[0];

    const vindex = new VectorIndex(corpus);
    const semHits = vindex.query(queryVec, mode === "semantic" ? limit : corpus.length);

    if (mode === "semantic") return semHits;

    const bmCorpus = corpus.map((e) => e.task);
    const queryTokens = tokenize(`${target.title} ${target.tags.join(" ")}`);
    const bmHits =
      queryTokens.length > 0 ? new BM25Index(bmCorpus).queryTokens(queryTokens, bmCorpus.length) : [];
    return rrfFuse([bmHits, semHits], limit);
  }

  return assertExhaustive(mode);
}
