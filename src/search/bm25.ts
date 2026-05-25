import type { Task } from "../task.js";
import { tokenize } from "./tokenize.js";
import type { SearchHit } from "./types.js";

/**
 * In-memory BM25 ranking over a fixed corpus of tasks.
 *
 * Document construction: `title title tags body`. Repeating the title is a
 * cheap weighting trick — it doubles the title's term frequencies AND its
 * contribution to document length. The length-normalization effect is small
 * (~1–2% score shift on typical corpora) and applied uniformly across the
 * corpus, so ranking order is essentially preserved. Proper BM25F (per-field
 * tf and length tracking) is the correct long-term fix; this is the v1
 * approximation.
 *
 * Parameters: k1 = 1.5, b = 0.75 (standard defaults; not exposed via config).
 *
 * IDF uses the Robertson–Spärck-Jones variant with +1 smoothing inside the
 * log: `log(1 + (N - df + 0.5) / (df + 0.5))`. This form is strictly positive
 * for any df in [1, N], so no guard against negative scores is needed.
 *
 * Adversarial-input protection: each document is capped to MAX_DOC_CHARS of
 * source text before tokenization, then to MAX_DOC_TOKENS tokens after. A
 * single multi-megabyte task body (committed log file, pasted binary,
 * minified JSON) cannot blow up the index — without these caps, one such
 * task would slow or OOM every `vt search` indefinitely, since the index is
 * rebuilt per query.
 */

const K1 = 1.5;
const B = 0.75;

// ~2 MB of source text per document. Larger than any reasonable task body;
// chosen to bound worst-case tokenization cost. Caller is responsible for
// surfacing this to the user if it matters — silent truncation is acceptable
// because the alternative is OOM.
const MAX_DOC_CHARS = 2_000_000;

// ~100k tokens per document. Belt-and-suspenders bound — a doc that fits
// within MAX_DOC_CHARS but tokenizes pathologically (e.g., a CSV with no
// repeated terms) is still capped.
const MAX_DOC_TOKENS = 100_000;

interface Posting {
  docId: number;
  tf: number;
}

interface TermStats {
  df: number;
  postings: Posting[];
}

export class BM25Index {
  // Snapshot of the input docs at construction time. The index is intentionally
  // a frozen view: mutating Task fields on the caller's array after the index
  // is built does NOT invalidate or rebuild it. Build a new BM25Index if you
  // need updated postings.
  private readonly docs: ReadonlyArray<Task>;
  private readonly docLengths: number[];
  private readonly terms: Map<string, TermStats>;
  private readonly idfCache: Map<string, number>;
  private readonly avgDocLen: number;

  constructor(docs: ReadonlyArray<Task>) {
    this.docs = docs.slice();
    this.docLengths = new Array(this.docs.length).fill(0);
    this.terms = new Map();
    this.idfCache = new Map();

    for (let i = 0; i < this.docs.length; i++) {
      const t = this.docs[i];
      const tagText = t.tags.join(" ");
      let text = `${t.title} ${t.title} ${tagText} ${t.body}`;
      if (text.length > MAX_DOC_CHARS) {
        text = text.slice(0, MAX_DOC_CHARS);
      }
      const tokens = tokenize(text);
      if (tokens.length > MAX_DOC_TOKENS) {
        tokens.length = MAX_DOC_TOKENS;
      }
      this.docLengths[i] = tokens.length;

      const tfMap = new Map<string, number>();
      for (const tok of tokens) {
        tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
      }

      for (const [term, tf] of tfMap) {
        let stats = this.terms.get(term);
        if (!stats) {
          stats = { df: 0, postings: [] };
          this.terms.set(term, stats);
        }
        stats.df++;
        stats.postings.push({ docId: i, tf });
      }
    }

    let totalLen = 0;
    for (const l of this.docLengths) totalLen += l;
    this.avgDocLen = this.docs.length > 0 ? totalLen / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  private idf(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;
    const stats = this.terms.get(term);
    if (!stats || stats.df === 0) {
      this.idfCache.set(term, 0);
      return 0;
    }
    const N = this.docs.length;
    const idf = Math.log(1 + (N - stats.df + 0.5) / (stats.df + 0.5));
    this.idfCache.set(term, idf);
    return idf;
  }

  query(queryText: string, limit = 20): SearchHit[] {
    return this.queryTokens(tokenize(queryText), limit);
  }

  queryTokens(queryTokens: ReadonlyArray<string>, limit = 20): SearchHit[] {
    if (this.docs.length === 0 || queryTokens.length === 0) return [];
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }

    const uniqueTerms = new Set(queryTokens);
    const scores = new Map<number, number>();
    const avgLen = this.avgDocLen || 1;

    for (const term of uniqueTerms) {
      const stats = this.terms.get(term);
      if (!stats) continue;
      const idf = this.idf(term);
      for (const { docId, tf } of stats.postings) {
        const docLen = this.docLengths[docId];
        const norm = 1 - B + B * (docLen / avgLen);
        const contribution = idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
      }
    }

    const hits: Array<{ docId: number; score: number }> = [];
    for (const [docId, score] of scores) {
      hits.push({ docId, score });
    }
    hits.sort((a, b) => b.score - a.score);

    return hits.slice(0, limit).map((h) => ({
      task: this.docs[h.docId],
      score: h.score,
      mode: "bm25" as const,
    }));
  }
}
