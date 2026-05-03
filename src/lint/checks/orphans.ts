/**
 * Orphan-evergreen detection.
 *
 * An evergreen note is "orphaned" when no other file links to it. This is
 * almost always a bug — evergreens earn their keep by being referenced — so
 * the lint surfaces them. Files that are intentionally orphan (inboxes,
 * drafts) can opt out via `lint_orphan_ok: true` in frontmatter.
 *
 * Implementation: build the inbound-link map from the resolved-link list
 * once, then filter the evergreen file list against it. Self-references do
 * not count as inbound. README files are exempt.
 */

import { resolveTarget } from "../resolve.js";
import type { ResolutionIndex, VaultFile, WikiLink } from "../types.js";

const README_STEMS = new Set(["README", "readme", "Readme", "index", "INDEX", "Index"]);

function basenameStem(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const tail = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  return tail.replace(/\.md$/, "");
}

/**
 * Compute, for every file, the set of distinct source files that link to it
 * via any resolvable wikilink. Used by both orphan and stale checks.
 */
export function buildInboundMap(
  links: WikiLink[],
  index: ResolutionIndex
): Map<string, Set<string>> {
  const inbound = new Map<string, Set<string>>();
  for (const link of links) {
    const resolved = resolveTarget(link.target, index);
    if (resolved === null) continue;
    if (resolved === link.source) continue;
    let set = inbound.get(resolved);
    if (!set) {
      set = new Set();
      inbound.set(resolved, set);
    }
    set.add(link.source);
  }
  return inbound;
}

export function findOrphanEvergreens(
  files: VaultFile[],
  inbound: Map<string, Set<string>>,
  evergreenDirRel: string
): string[] {
  const dirPrefix = evergreenDirRel.replace(/\/+$/, "");
  if (!dirPrefix) return [];

  const out: string[] = [];
  for (const f of files) {
    if (f.relPath !== `${dirPrefix}` && !f.relPath.startsWith(`${dirPrefix}/`)) continue;
    if (README_STEMS.has(basenameStem(f.relPath))) continue;
    if (f.lintOpts.orphanOk) continue;
    const incoming = inbound.get(f.relPath);
    if (!incoming || incoming.size === 0) {
      out.push(f.relPath);
    }
  }
  out.sort();
  return out;
}
