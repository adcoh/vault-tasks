/**
 * Vault lint orchestrator.
 *
 * Walks the vault, builds the resolution index, runs the four checks
 * (broken / orphans / stale / drift), attaches "did you mean?" suggestions
 * to broken links, and returns a LintReport. Read-only by design; never
 * writes to the vault.
 *
 * The orchestrator is structured so callers can run a subset of checks
 * (`only`) or scope to a subtree (`scope`). Resolution always uses the full
 * vault index — scoping a check to a subtree should not cause links inside
 * that subtree to look broken just because their target is outside it.
 */

import { relative, sep } from "node:path";
import type { Config } from "../config.js";
import { findBrokenLinks } from "./checks/broken.js";
import { findEvergreenDrift } from "./checks/drift.js";
import { buildInboundMap, findOrphanEvergreens } from "./checks/orphans.js";
import { findStaleReferences } from "./checks/stale.js";
import { collectWikilinks, readVaultFiles } from "./collect.js";
import { buildIndex } from "./resolve.js";
import { attachSuggestions, computeLeverageFixes } from "./suggest.js";
import type { LintOptions, LintReport, VaultFile } from "./types.js";

export * from "./types.js";
export { buildIndex, normKey, resolveTarget, stripTargetSuffixes } from "./resolve.js";
export { collectWikilinks, isTemplatePlaceholder, readVaultFiles } from "./collect.js";
export { findBrokenLinks } from "./checks/broken.js";
export { buildInboundMap, findOrphanEvergreens } from "./checks/orphans.js";
export { findStaleReferences } from "./checks/stale.js";
export { findEvergreenDrift } from "./checks/drift.js";
export { attachSuggestions, computeLeverageFixes } from "./suggest.js";
export { formatHumanReport, formatJsonReport, formatSummaryLine } from "./report.js";

function toRelPosix(absPath: string, vaultRoot: string): string {
  return relative(vaultRoot, absPath).split(sep).join("/");
}

function relPathPosix(p: string): string {
  return p.split(sep).join("/");
}

function normaliseScope(scope: string | undefined): string | null {
  if (!scope) return null;
  const cleaned = relPathPosix(scope).replace(/^\.\/+/, "").replace(/\/+$/, "");
  return cleaned === "" ? null : cleaned;
}

function inScope(relPath: string, scope: string | null): boolean {
  if (scope === null) return true;
  return relPath === scope || relPath.startsWith(`${scope}/`);
}

/**
 * Run the lint checks against a vault and return a structured report.
 */
export function lintVault(config: Config, opts: LintOptions = {}): LintReport {
  const warnings: string[] = [];
  // Always accumulate into the report; forward to opts.onWarn if provided.
  // The report's `warnings` field is what `--json` and `formatHumanReport`
  // surface, so dropping warnings when a callback is set silently degrades
  // the JSON output.
  const onWarn = (msg: string): void => {
    warnings.push(msg);
    opts.onWarn?.(msg);
  };

  const lint = config.lint;
  const evergreenDirRel = toRelPosix(config.evergreenDir, config.vaultRoot);
  const referenceDirRel = toRelPosix(lint.referenceDir, config.vaultRoot);

  const allFiles = readVaultFiles(config.vaultRoot, lint.skipDirs, onWarn);
  const index = buildIndex(allFiles);

  for (const [key, paths] of index.collisions) {
    onWarn(
      `${paths.length} files share normalised key '${key}': ${paths.join(", ")}`
    );
  }

  const scope = normaliseScope(opts.scope);
  const scopedFiles: VaultFile[] = scope === null
    ? allFiles
    : allFiles.filter((f) => inScope(f.relPath, scope));

  const allLinks = collectWikilinks(
    allFiles,
    lint.templateSourceDirs,
    lint.templateSourceFiles,
    lint.templatePatterns
  );

  const scopedLinks = scope === null
    ? allLinks
    : allLinks.filter((l) => inScope(l.source, scope));

  const inbound = buildInboundMap(allLinks, index);

  const wantBroken = !opts.only || opts.only === "broken";
  const wantOrphans = !opts.only || opts.only === "orphans";
  const wantStale = !opts.only || opts.only === "stale";
  const wantDrift = !opts.only || opts.only === "drift";

  const broken = wantBroken ? findBrokenLinks(scopedLinks, index) : [];
  if (wantBroken && !opts.noSuggestions) {
    attachSuggestions(broken, index, lint.suggestionThreshold);
  }
  const leverageFixes = wantBroken && !opts.noSuggestions
    ? computeLeverageFixes(broken)
    : [];

  const orphans = wantOrphans
    ? findOrphanEvergreens(scopedFiles, inbound, evergreenDirRel)
    : [];

  const stale = wantStale
    ? findStaleReferences(
        scopedFiles,
        inbound,
        referenceDirRel,
        lint.referenceExclude
      )
    : [];

  const drift = wantDrift
    ? findEvergreenDrift(scopedFiles, evergreenDirRel, lint.evergreenConventions)
    : [];

  const summary = {
    broken: broken.length,
    orphans: orphans.length,
    stale: stale.length,
    drift: drift.length,
  };
  const hasIssues =
    summary.broken > 0 ||
    summary.orphans > 0 ||
    summary.stale > 0 ||
    summary.drift > 0;

  return {
    broken,
    orphans,
    stale,
    drift,
    leverageFixes,
    warnings,
    summary,
    hasIssues,
  };
}
