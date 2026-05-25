import type { Task } from "../task.js";
import { tokenize } from "./tokenize.js";
import type { SearchHit } from "./types.js";

/**
 * In-memory BM25 ranking over a fixed corpus of tasks.
 *
 * Documents are built as `title title tags body` — the title is repeated to
 * roughly double its weight (a cheap stand-in for per-field BM25F without the
 * extra bookkeeping). Tags are concatenated with spaces and tokenized like the
 * rest of the document.
 *
 * Parameters use the standard defaults (k1 = 1.5, b = 0.75). They are not
 * exposed via config in v1 — change them here if there's evidence they help.
 *
 * IDF uses the Robertson–Spärck-Jones variant with +1 smoothing inside the
 * log, which keeps scores non-negative even for terms appearing in more than
 * half the corpus (the bare `log((N - df + 0.5) / (df + 0.5))` form goes
 * negative there).
 */

const K1 = 1.5;
const B = 0.75;

interface Posting {
  docId: number;
  tf: number;
}

interface TermStats {
  df: number;
  postings: Posting[];
}

export class BM25Index {
  private readonly docs: ReadonlyArray<Task>;
  private readonly docLengths: number[];
  private readonly terms: Map<string, TermStats>;
  private readonly idfCache: Map<string, number>;
  private readonly avgDocLen: number;

  constructor(docs: ReadonlyArray<Task>) {
    this.docs = docs;
    this.docLengths = new Array(docs.length);
    this.terms = new Map();
    this.idfCache = new Map();

    for (let i = 0; i < docs.length; i++) {
      const t = docs[i];
      const tagText = t.tags.join(" ");
      const text = `${t.title} ${t.title} ${tagText} ${t.body}`;
      const tokens = tokenize(text);
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

    const totalLen = this.docLengths.reduce((s, l) => s + l, 0);
    this.avgDocLen = docs.length > 0 ? totalLen / docs.length : 0;
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
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }

    const uniqueTerms = new Set(queryTokens);
    const scores = new Map<number, number>();
    const avgLen = this.avgDocLen || 1;

    for (const term of uniqueTerms) {
      const stats = this.terms.get(term);
      if (!stats) continue;
      const idf = this.idf(term);
      if (idf <= 0) continue;
      for (const { docId, tf } of stats.postings) {
        const docLen = this.docLengths[docId];
        const norm = 1 - B + B * (docLen / avgLen);
        const contribution = idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
      }
    }

    const hits: Array<{ docId: number; score: number }> = [];
    for (const [docId, score] of scores) {
      if (score > 0) hits.push({ docId, score });
    }
    hits.sort((a, b) => b.score - a.score);

    return hits.slice(0, limit).map((h) => ({
      task: this.docs[h.docId],
      score: h.score,
      mode: "bm25" as const,
    }));
  }
}
