/**
 * Stale-reference detection.
 *
 * A reference note is "stale" when nothing in the vault links to it. Same
 * mechanism as orphan-evergreen detection, but scoped to the references
 * directory and respecting per-vault path exclusions (e.g. `tweets/`).
 * Files can opt out via `lint_stale_ok: true` in frontmatter.
 */

import type { VaultFile } from "../types.js";

const README_STEMS = new Set(["README", "readme", "Readme", "index", "INDEX", "Index"]);

function basenameStem(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const tail = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  return tail.replace(/\.md$/, "");
}

export function findStaleReferences(
  files: VaultFile[],
  inbound: Map<string, Set<string>>,
  referenceDirRel: string,
  referenceExclude: string[]
): string[] {
  const dirPrefix = referenceDirRel.replace(/\/+$/, "");
  if (!dirPrefix) return [];

  const out: string[] = [];
  for (const f of files) {
    if (f.relPath !== dirPrefix && !f.relPath.startsWith(`${dirPrefix}/`)) continue;
    if (README_STEMS.has(basenameStem(f.relPath))) continue;
    if (f.lintOpts.staleOk) continue;
    const excluded = referenceExclude.some((pattern) => {
      if (!pattern) return false;
      const trimmed = pattern.replace(/\/+$/, "");
      if (!trimmed) return false;
      // Match the pattern as either a leading subdir (relative to the
      // reference root) or anywhere in the path.
      return (
        f.relPath.includes(`/${trimmed}/`) ||
        f.relPath.startsWith(`${dirPrefix}/${trimmed}/`)
      );
    });
    if (excluded) continue;

    const incoming = inbound.get(f.relPath);
    if (!incoming || incoming.size === 0) {
      out.push(f.relPath);
    }
  }
  out.sort();
  return out;
}
