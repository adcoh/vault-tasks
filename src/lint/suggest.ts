/**
 * "Did you mean?" suggestions for broken wikilink targets.
 *
 * Implementation: trigram-Dice similarity (`src/similarity.ts`) against
 * three candidate kinds — basenames, titles, and aliases — across the whole
 * vault. The candidate scoring uses a stable preference order:
 *   1. higher similarity
 *   2. shorter candidate string (less ambiguous match)
 *   3. lexicographic
 *
 * Only suggestions at or above the configured threshold are kept; the top
 * two are attached to each broken entry. Suggestions are also rolled up
 * into a "leverage view" that ranks fixes by how many broken occurrences
 * they would close — usually a single alias addition closes dozens of
 * links at once.
 */

import { similarity } from "../similarity.js";
import type {
  BrokenEntry,
  LeverageFix,
  ResolutionIndex,
  Suggestion,
  VaultFile,
} from "./types.js";

interface Candidate {
  text: string;
  kind: "basename" | "title" | "alias";
  filePath: string;
}

function basename(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const tail = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  return tail.replace(/\.md$/, "");
}

function buildCandidates(files: VaultFile[]): Candidate[] {
  const out: Candidate[] = [];
  for (const f of files) {
    out.push({ text: basename(f.relPath), kind: "basename", filePath: f.relPath });
    if (f.title) {
      out.push({ text: f.title, kind: "title", filePath: f.relPath });
    }
    for (const alias of f.aliases) {
      if (alias) out.push({ text: alias, kind: "alias", filePath: f.relPath });
    }
  }
  return out;
}

/**
 * Compute up to `topN` suggestions per broken entry, mutating each entry's
 * `suggestions` array in place. Skips suggestion lookup entirely when
 * `threshold` <= 0 — a documented opt-out for `--no-suggestions`.
 */
export function attachSuggestions(
  broken: BrokenEntry[],
  index: ResolutionIndex,
  threshold: number,
  topN: number = 2
): void {
  if (broken.length === 0 || threshold <= 0) return;

  const candidates = buildCandidates(index.files);
  if (candidates.length === 0) return;

  for (const entry of broken) {
    const scored: Array<{ cand: Candidate; sim: number }> = [];
    for (const cand of candidates) {
      const sim = similarity(entry.target, cand.text);
      if (sim >= threshold) {
        scored.push({ cand, sim });
      }
    }
    scored.sort((a, b) => {
      if (b.sim !== a.sim) return b.sim - a.sim;
      if (a.cand.text.length !== b.cand.text.length) {
        return a.cand.text.length - b.cand.text.length;
      }
      return a.cand.text.localeCompare(b.cand.text);
    });

    // Dedupe by file path so we don't show two suggestions pointing at the
    // same file (basename + title of the same note typically score similar).
    const seenPaths = new Set<string>();
    const picked: Suggestion[] = [];
    for (const { cand, sim } of scored) {
      if (seenPaths.has(cand.filePath)) continue;
      seenPaths.add(cand.filePath);
      picked.push({
        filePath: cand.filePath,
        candidate: cand.text,
        kind: cand.kind,
        similarity: sim,
        proposedAlias: entry.target,
      });
      if (picked.length >= topN) break;
    }
    entry.suggestions = picked;
  }
}

/**
 * Compute the "high-leverage fixes" view: aggregate broken entries by their
 * top suggestion's file path and sum the broken counts. The result is the
 * single sentence "adding alias X to file Y closes N broken links",
 * sorted by N descending.
 */
export function computeLeverageFixes(broken: BrokenEntry[]): LeverageFix[] {
  const buckets = new Map<string, { closes: number; aliases: string[] }>();
  for (const entry of broken) {
    const top = entry.suggestions[0];
    if (!top) continue;
    const bucket = buckets.get(top.filePath);
    if (bucket) {
      bucket.closes += entry.count;
      if (!bucket.aliases.includes(entry.target)) {
        bucket.aliases.push(entry.target);
      }
    } else {
      buckets.set(top.filePath, { closes: entry.count, aliases: [entry.target] });
    }
  }
  const fixes: LeverageFix[] = [];
  for (const [filePath, { closes, aliases }] of buckets) {
    fixes.push({
      action: `add alias to ${filePath}`,
      closes,
      filePath,
      aliases: [...aliases].sort(),
    });
  }
  fixes.sort((a, b) => {
    if (b.closes !== a.closes) return b.closes - a.closes;
    return a.filePath.localeCompare(b.filePath);
  });
  return fixes;
}
