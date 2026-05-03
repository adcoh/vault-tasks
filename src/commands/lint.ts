import type { Config } from "../config.js";
import { lintVault } from "../lint/index.js";
import {
  formatHumanReport,
  formatJsonReport,
  formatSummaryLine,
} from "../lint/report.js";
import type { CheckName } from "../lint/types.js";

const VALID_CHECKS: ReadonlySet<CheckName> = new Set(["broken", "orphans", "stale", "drift"]);

interface LintCmdArgs {
  only?: string;
  scope?: string;
  json?: boolean;
  quiet?: boolean;
  noSuggestions?: boolean;
}

export function cmdLint(config: Config, args: LintCmdArgs): void {
  let only: CheckName | undefined;
  if (args.only !== undefined) {
    const v = args.only.toLowerCase();
    if (!VALID_CHECKS.has(v as CheckName)) {
      console.error(
        `Error: --only must be one of broken|orphans|stale|drift (got '${args.only}')`
      );
      process.exitCode = 2;
      return;
    }
    only = v as CheckName;
  }

  if (args.scope !== undefined && args.scope.includes("..")) {
    console.error("Error: --scope must be inside the vault (no '..')");
    process.exitCode = 2;
    return;
  }

  let report;
  try {
    report = lintVault(config, {
      only,
      scope: args.scope,
      noSuggestions: args.noSuggestions === true,
      onWarn: (msg) => console.error(`WARN: ${msg}`),
    });
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 2;
    return;
  }

  if (args.quiet === true) {
    console.log(formatSummaryLine(report));
  } else if (args.json === true) {
    console.log(formatJsonReport(report));
  } else {
    console.log(formatHumanReport(report));
  }

  process.exitCode = report.hasIssues ? 1 : 0;
}
