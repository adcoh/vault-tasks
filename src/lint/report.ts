/**
 * Human-readable and JSON formatters for a LintReport.
 *
 * The human format is shaped for solo-dev terminal review. The JSON format
 * preserves the full report data for CI dashboards and downstream tooling.
 */

import type { LintReport } from "./types.js";

const MAX_LOCATIONS_PER_TARGET = 3;

function formatSimilarity(n: number): string {
  return n.toFixed(2);
}

export function formatSummaryLine(report: LintReport): string {
  const { broken, orphans, stale, drift } = report.summary;
  return `SUMMARY: broken:${broken} orphans:${orphans} stale:${stale} drift:${drift}`;
}

export function formatHumanReport(report: LintReport): string {
  const out: string[] = [];

  if (report.warnings.length > 0) {
    out.push(`=== WARNINGS (${report.warnings.length}) ===`);
    for (const w of report.warnings) {
      out.push(`  ${w}`);
    }
    out.push("");
  }

  if (report.leverageFixes.length > 0) {
    out.push(`=== HIGH-LEVERAGE FIXES (${report.leverageFixes.length}) ===`);
    for (const fix of report.leverageFixes) {
      const aliasList = fix.aliases.length === 1
        ? `[${fix.aliases[0]}]`
        : `[${fix.aliases.join(", ")}]`;
      out.push(`  ${fix.action}: aliases ${aliasList}  closes ${fix.closes} broken link${fix.closes === 1 ? "" : "s"}`);
    }
    out.push("");
  }

  out.push(`=== BROKEN WIKILINKS (${report.broken.length}) ===`);
  for (const entry of report.broken) {
    out.push(`  [[${entry.target}]]  (${entry.count} occurrence${entry.count === 1 ? "" : "s"})`);
    for (const sugg of entry.suggestions) {
      out.push(
        `    suggest: ${sugg.filePath}  (sim ${formatSimilarity(sugg.similarity)}, ${sugg.kind} "${sugg.candidate}")`
      );
      if (sugg.kind !== "alias") {
        out.push(`      → adding \`aliases: [${sugg.proposedAlias}]\` to that file would close all ${entry.count}`);
      }
    }
    const limit = MAX_LOCATIONS_PER_TARGET;
    const visible = entry.locations.slice(0, limit);
    if (visible.length > 0) {
      out.push(`    locations:`);
      for (const loc of visible) {
        out.push(`      ${loc.source}:${loc.line}`);
      }
      if (entry.locations.length > visible.length) {
        out.push(`      ... +${entry.locations.length - visible.length} more`);
      }
    }
  }
  out.push("");

  out.push(`=== ORPHAN EVERGREENS (${report.orphans.length}) ===`);
  for (const o of report.orphans) {
    out.push(`  ${o}`);
  }
  out.push("");

  out.push(`=== STALE REFERENCES (${report.stale.length}) ===`);
  for (const s of report.stale) {
    out.push(`  ${s}`);
  }
  out.push("");

  out.push(`=== CONVENTION DRIFT (${report.drift.length}) ===`);
  for (const d of report.drift) {
    out.push(`  ${d.filePath}: ${d.issues.join(", ")}`);
  }
  out.push("");

  out.push(formatSummaryLine(report));
  return out.join("\n");
}

export function formatJsonReport(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}
