/**
 * Broken-wikilink detection.
 *
 * For each link, attempt resolution against the index. Links that fail to
 * resolve are aggregated by target so a single missing file shows up as one
 * row with a count, not N noisy rows. Output is sorted by frequency
 * descending — the most-broken target is the highest-leverage fix.
 */

import type { ResolutionIndex, BrokenEntry, WikiLink } from "../types.js";
import { resolveTarget } from "../resolve.js";

export function findBrokenLinks(
  links: WikiLink[],
  index: ResolutionIndex
): BrokenEntry[] {
  const buckets = new Map<string, BrokenEntry>();

  for (const link of links) {
    const resolved = resolveTarget(link.target, index);
    if (resolved !== null) continue;

    const existing = buckets.get(link.target);
    if (existing) {
      existing.count += 1;
      existing.locations.push({ source: link.source, line: link.line });
    } else {
      buckets.set(link.target, {
        target: link.target,
        count: 1,
        locations: [{ source: link.source, line: link.line }],
        suggestions: [],
      });
    }
  }

  const entries = [...buckets.values()];
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.target.localeCompare(b.target);
  });
  return entries;
}
