/**
 * Zero-dependency trigram similarity for detecting duplicate task titles.
 *
 * Uses the Dice coefficient on character trigrams (3-char sliding windows).
 * Handles word reordering naturally — "fix auth bug" ≈ "auth bug fix".
 */

/**
 * Normalize a string for comparison: lowercase, fold diacritics, strip
 * punctuation, collapse whitespace. Uses Unicode letter/number classes so
 * non-ASCII titles (e.g. "café résumé") still produce meaningful trigrams
 * instead of degenerate empty strings.
 */
function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // drop combining marks (diacritics)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate the set of character trigrams from a string.
 */
function trigrams(s: string): Set<string> {
  const result = new Set<string>();
  const padded = ` ${s} `; // pad to capture word boundaries
  for (let i = 0; i <= padded.length - 3; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Compute the Dice coefficient between two trigram sets.
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }

  return (2 * intersection) / (a.size + b.size);
}

/**
 * Compute similarity between two strings using trigram Dice coefficient.
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.0;

  return diceCoefficient(trigrams(na), trigrams(nb));
}

/**
 * Normalize then trigram a string, for callers that compare one string
 * against many others (e.g. lint suggestion scoring) and want to compute
 * each side's trigram set once instead of on every pairwise comparison.
 */
export function trigramsOf(s: string): Set<string> {
  return trigrams(normalize(s));
}

/**
 * Compute the Dice coefficient between two pre-computed trigram sets, as
 * produced by `trigramsOf`.
 *
 * Equivalent to `similarity(a, b)`: for all strings a, b,
 * `similarityFromSets(trigramsOf(a), trigramsOf(b)) === similarity(a, b)`.
 * This holds at the edges too — two strings that normalize to the same text
 * produce equal trigram sets, so the Dice coefficient is 1.0 either way;
 * punctuation-only strings normalize to "" and trigram to the empty set, so
 * two such strings give 1.0 (both empty) and one-empty-one-nonempty gives
 * 0.0, matching `similarity`'s short-circuit behavior.
 */
export function similarityFromSets(a: Set<string>, b: Set<string>): number {
  return diceCoefficient(a, b);
}
