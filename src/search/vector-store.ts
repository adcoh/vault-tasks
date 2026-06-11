import type { Task } from "../task.js";
import type { SearchHit } from "./types.js";

/**
 * In-memory cosine-similarity index over a fixed corpus of task vectors.
 *
 * Mirrors BM25Index (src/search/bm25.ts): a frozen snapshot built once per
 * query, ranking by cosine similarity. Vectors are L2-normalized at
 * construction, so ranking reduces to a dot product at query time.
 *
 * For a vault of hundreds–low-thousands of tasks, brute-force scan is
 * sub-millisecond — no ANN index (HNSW/IVF) is warranted, and adding one would
 * mean a native dependency, which this package does not take.
 */
export class VectorIndex {
  private readonly tasks: ReadonlyArray<Task>;
  private readonly vectors: Float64Array[];
  private readonly dim: number;

  /**
   * @param items task + raw embedding pairs. All vectors must share one
   *   dimensionality; a mismatch is a corrupt-cache / mixed-model bug and throws.
   */
  constructor(items: ReadonlyArray<{ task: Task; vector: number[] }>) {
    this.tasks = items.map((it) => it.task);
    this.vectors = [];
    this.dim = items.length > 0 ? items[0].vector.length : 0;

    for (let i = 0; i < items.length; i++) {
      const v = items[i].vector;
      if (v.length !== this.dim) {
        throw new Error(
          `Vector dimension mismatch at item ${i}: expected ${this.dim}, got ${v.length}. ` +
          `The embedding cache may be from a different model — delete .vault-tasks/embeddings.json.`
        );
      }
      this.vectors.push(normalize(v, i));
    }
  }

  get size(): number {
    return this.tasks.length;
  }

  get dimensions(): number {
    return this.dim;
  }

  /**
   * Return the top `limit` tasks by cosine similarity to `queryVector`,
   * highest first. Scores lie in [-1, 1]. A zero-magnitude query has no
   * direction to compare, so it yields no hits.
   */
  query(queryVector: number[], limit = 20): SearchHit[] {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }
    if (this.tasks.length === 0) return [];
    if (queryVector.length !== this.dim) {
      throw new Error(
        `Query vector dimension ${queryVector.length} does not match index dimension ${this.dim}.`
      );
    }
    const q = normalize(queryVector, -1);
    // normalize() returns a zero vector unchanged; detect that to avoid emitting
    // a flat ranking of all-zero scores.
    if (isZero(q)) return [];

    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.vectors.length; i++) {
      const v = this.vectors[i];
      let dot = 0;
      for (let d = 0; d < this.dim; d++) dot += q[d] * v[d];
      scored.push({ idx: i, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => ({
      task: this.tasks[s.idx],
      score: s.score,
      mode: "semantic" as const,
    }));
  }
}

function normalize(vec: number[], idx: number): Float64Array {
  const out = new Float64Array(vec.length);
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i];
    if (typeof x !== "number" || !Number.isFinite(x)) {
      throw new Error(
        `Non-finite value in vector${idx >= 0 ? ` at item ${idx}` : ""} (position ${i}).`
      );
    }
    out[i] = x;
    sumSq += x * x;
  }
  const mag = Math.sqrt(sumSq);
  if (mag === 0) return out; // zero vector — leave as zeros, caller handles
  for (let i = 0; i < out.length; i++) out[i] /= mag;
  return out;
}

function isZero(vec: Float64Array): boolean {
  for (const x of vec) if (x !== 0) return false;
  return true;
}
