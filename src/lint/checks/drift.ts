/**
 * Convention-drift detection on evergreens.
 *
 * Evergreens have a strong shape: frontmatter with title and tags, body
 * with at least one wikilink, and a `## Related` section anchoring the
 * note in the graph. Drift here surfaces evergreens that fell out of that
 * shape — usually because they were dropped in by hand or by an earlier
 * iteration of a skill that has since changed. Each requirement is
 * individually configurable. Files opt out per-file via
 * `lint_drift_ok: true` in frontmatter.
 */

import type { LintEvergreenConventions } from "../../config.js";
import type { DriftEntry, VaultFile } from "../types.js";

const README_STEMS = new Set(["README", "readme", "Readme", "index", "INDEX", "Index"]);
const RELATED_HEADING_RE = /^##+\s+Related\b/m;
const ANY_WIKILINK_RE = /\[\[[^\]\n]+\]\]/;

function basenameStem(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const tail = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  return tail.replace(/\.md$/, "");
}

export function findEvergreenDrift(
  files: VaultFile[],
  evergreenDirRel: string,
  conventions: LintEvergreenConventions
): DriftEntry[] {
  const dirPrefix = evergreenDirRel.replace(/\/+$/, "");
  if (!dirPrefix) return [];

  const out: DriftEntry[] = [];
  for (const f of files) {
    if (f.relPath !== dirPrefix && !f.relPath.startsWith(`${dirPrefix}/`)) continue;
    if (README_STEMS.has(basenameStem(f.relPath))) continue;
    if (f.lintOpts.driftOk) continue;

    const issues: string[] = [];
    if (conventions.requireFrontmatter && !f.hasFrontmatter) {
      issues.push("no frontmatter");
    } else {
      if (conventions.requireTitleField && !f.title) {
        issues.push("no title field");
      }
      if (conventions.requireTagsField && !f.hasTagsField) {
        issues.push("no tags field");
      }
    }
    if (conventions.requireBodyWikilink && !ANY_WIKILINK_RE.test(f.body)) {
      issues.push("no wikilinks in body");
    }
    if (conventions.requireRelatedSection && !RELATED_HEADING_RE.test(f.text)) {
      issues.push("no ## Related section");
    }

    if (issues.length > 0) {
      out.push({ filePath: f.relPath, issues });
    }
  }
  out.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return out;
}
