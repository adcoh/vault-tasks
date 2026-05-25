/**
 * Unicode-aware word tokenizer shared by BM25 (and, later, the embedder doc-prep).
 *
 * Splits on any run of non-letter / non-number characters, after NFKD folding
 * (so "café" → "cafe" instead of becoming an opaque non-ASCII token) and
 * lowercasing. Filters out single-character tokens — they explode the index
 * (every "a", "I", punctuation residue) without carrying signal.
 *
 * No stemming, no stop-word list. Adding them is plausible later but each is
 * language-specific and would force a config surface this module deliberately
 * avoids in v1.
 */
export function tokenize(s: string): string[] {
  if (!s) return [];
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}
