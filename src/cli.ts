#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { cmdArchive } from "./commands/archive.js";
import { cmdDone } from "./commands/done.js";
import { cmdEdit } from "./commands/edit.js";
import { cmdInit } from "./commands/init.js";
import { cmdInstallSkills } from "./commands/install-skills.js";
import { cmdLint } from "./commands/lint.js";
import { cmdList } from "./commands/list.js";
import { cmdNew } from "./commands/new.js";
import { cmdSearch } from "./commands/search.js";
import { cmdShow } from "./commands/show.js";
import { cmdStale } from "./commands/stale.js";
import { cmdStart } from "./commands/start.js";
import { cmdTags } from "./commands/tags.js";

const USAGE = `vault-tasks — markdown-file task manager

Usage: vt <command> [options]

Commands:
  new <title>           Create a new task
  list                  List tasks
  search <keyword>      Search tasks by title and body (--mode keyword|bm25, --like <id>, --limit N)
  stale                 List stale open tasks
  show <id>             Show full task
  done <id>             Mark task as done
  start <id>            Mark task as in-progress
  edit <id>             Edit task fields (--status, --priority, --tags)
  archive               Move completed tasks to archive
  tags                  List all tags in use
  lint                  Audit the vault for broken wikilinks, orphans, stale refs, drift
  init                  Initialize vault-tasks in current directory
  install-skills        Install Claude Code skills and rules

Options (vary by command):
  --priority, -p        high, medium, or low
  --tags, -t            Comma-separated tags
  --source, -s          Where this was noticed
  --body                Task body as inline string (use - for stdin)
  --body-file           Task body read from file path
  --commit              Git commit after creating
  --no-dedupe           Skip duplicate detection (new)
  --status              Filter or set status
  --tag                 Filter by tag
  --all, -a             Include done/archived tasks (list, search)
  --install              Install all skills and rules (install-skills)
  --days, -d            Stale threshold in days (default: 14)
  --list                List available skills
  --update              Overwrite existing skill files
  --only                Run a single lint check (broken|orphans|stale|drift)
  --scope               Restrict lint to files under <dir>
  --json                Machine-readable lint output
  --quiet               Print only the lint SUMMARY line
  --no-suggestions      Skip "did you mean?" suggestions in lint
  --mode                Search mode: keyword (default) or bm25
  --like                Find tasks similar to <id> (requires --mode bm25)
  --limit               Maximum number of search results
  --help, -h            Show this help message
`;

const BOOLEAN_FLAGS = new Set([
  "all",
  "commit",
  "install",
  "list",
  "update",
  "help",
  "no-dedupe",
  "json",
  "quiet",
  "no-suggestions",
]);

// Flags that require a value. parseArgs throws an actionable error when one
// of these is passed without a value (e.g. `vt new T --priority` followed by
// EOL or another flag) so commands never receive a boolean for a string field.
const VALUE_FLAGS = new Set([
  "priority",
  "tags",
  "source",
  "body",
  "body-file",
  "status",
  "tag",
  "days",
  "only",
  "scope",
  "mode",
  "like",
  "limit",
]);

const VALUE_FLAG_HINTS: Record<string, string> = {
  priority: "high, medium, or low",
  tags: "comma-separated tag names",
  source: "where this was noticed (e.g. [[2026-05-09]])",
  body: "a string, or '-' to read from stdin",
  "body-file": "a file path",
  status: "open, in-progress, done, or wont-do",
  tag: "a tag name",
  days: "a positive integer",
  only: "broken|orphans|stale|drift",
  scope: "a directory",
  mode: "keyword or bm25",
  like: "a task id (e.g. 0042 or 01HXY...)",
  limit: "a positive integer",
};

function missingValueError(key: string): Error {
  const hint = VALUE_FLAG_HINTS[key];
  return new Error(`Flag --${key} requires a value${hint ? ` (${hint})` : ""}.`);
}

/**
 * Sentinel returned by parsePositiveIntFlag when validation fails. The caller
 * is expected to short-circuit (the helper already wrote an error and set the
 * exit code). Using a sentinel keeps the call sites at one line each.
 */
const FLAG_INVALID = Symbol("flag-invalid");

/**
 * Coerce any thrown value to a printable diagnostic string. `(err as Error).message`
 * yields literal `undefined` for string/null/object rejections — and crashes
 * on `throw undefined`. Surface the rejection regardless of its shape so the
 * user sees something actionable instead of `undefined\n`.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === undefined) return "Unknown error (no message)";
  if (err === null) return "Unknown error (null)";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Strict positive-integer parser for CLI flag values.
 *
 * `parseInt('5abc', 10)` returns 5 — silently accepting garbage suffixes —
 * and `Number.isInteger` accepts non-safe-integer huge values like 1e20.
 * Both behaviors fail the contract documented for `--limit` and `--days`.
 * This helper rejects anything that isn't a bare run of ASCII digits parsing
 * to a safe positive integer.
 */
function parsePositiveIntFlag(
  raw: string | boolean | undefined,
  flag: string
): number | undefined | typeof FLAG_INVALID {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    console.error(`Error: --${flag} must be a positive integer`);
    process.exitCode = 1;
    return FLAG_INVALID;
  }
  const n = parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    console.error(`Error: --${flag} must be a positive integer`);
    process.exitCode = 1;
    return FLAG_INVALID;
  }
  return n;
}

function isFlag(arg: string): boolean {
  if (arg.startsWith("--")) return true;
  if (arg.startsWith("-") && arg.length === 2 && /[a-zA-Z]/.test(arg[1])) return true;
  return false;
}

function parseArgs(argv: string[]): { command: string; args: Record<string, string | boolean>; positional: string[] } {
  const command = argv[0] ?? "";
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  const shortFlags: Record<string, string> = {
    p: "priority",
    t: "tags",
    s: "source",
    a: "all",
    d: "days",
    h: "help",
  };

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const key = arg.slice(2, eqIdx);
      const rawValue = arg.slice(eqIdx + 1);
      if (BOOLEAN_FLAGS.has(key)) {
        const lower = rawValue.toLowerCase();
        if (lower === "true" || lower === "1" || lower === "") {
          args[key] = true;
        } else if (lower === "false" || lower === "0") {
          args[key] = false;
        } else {
          throw new Error(
            `Flag --${key} is boolean; expected true/false/1/0 but got '${rawValue}'. ` +
            `Either pass --${key} on its own, or use --${key}=true / --${key}=false.`
          );
        }
      } else {
        if (VALUE_FLAGS.has(key) && rawValue === "") {
          throw missingValueError(key);
        }
        args[key] = rawValue;
      }
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
        i++;
      } else {
        const next = argv[i + 1];
        if (next && !isFlag(next)) {
          args[key] = next;
          i += 2;
        } else if (VALUE_FLAGS.has(key)) {
          throw missingValueError(key);
        } else {
          args[key] = true;
          i++;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2 && /[a-zA-Z]/.test(arg[1])) {
      const key = shortFlags[arg[1]] ?? arg[1];
      if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
        i++;
      } else {
        const next = argv[i + 1];
        if (next && !isFlag(next)) {
          args[key] = next;
          i += 2;
        } else if (VALUE_FLAGS.has(key)) {
          throw missingValueError(key);
        } else {
          args[key] = true;
          i++;
        }
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { command, args, positional };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(USAGE);
    return;
  }

  let command: string;
  let args: Record<string, string | boolean>;
  let positional: string[];
  try {
    ({ command, args, positional } = parseArgs(rawArgs));
  } catch (err) {
    console.error(errorMessage(err));
    process.exitCode = 2;
    return;
  }

  // init doesn't need config
  if (command === "init") {
    cmdInit({ dir: positional[0] });
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(errorMessage(err));
    process.exitCode = 1;
    return;
  }

  // install-skills needs vault root but not necessarily a full config

  try {
    switch (command) {
      case "install-skills":
        cmdInstallSkills(config, {
          install: args["install"] === true,
          list: args["list"] === true,
          update: args["update"] === true,
        });
        break;

      case "new":
        if (!positional[0]) {
          console.error("Usage: vt new <title> [--priority P] [--tags t1,t2] [--source S] [--commit] [--body TEXT|--body-file PATH]");
          process.exitCode = 1;
          return;
        }
        cmdNew(config, {
          title: positional[0],
          priority: (args["priority"] as string | undefined)?.toLowerCase(),
          tags: args["tags"] as string | undefined,
          source: args["source"] as string | undefined,
          body: args["body"] as string | undefined,
          bodyFile: args["body-file"] as string | undefined,
          commit: args["commit"] === true,
          noDedupe: args["no-dedupe"] === true,
        });
        break;

      case "list":
        cmdList(config, {
          status: (args["status"] as string | undefined)?.toLowerCase(),
          priority: (args["priority"] as string | undefined)?.toLowerCase(),
          tag: args["tag"] as string | undefined,
          all: args["all"] === true,
        });
        break;

      case "search": {
        const limit = parsePositiveIntFlag(args["limit"], "limit");
        if (limit === FLAG_INVALID) return;
        if (!positional[0] && args["like"] === undefined) {
          console.error(
            "Usage:\n" +
            "  vt search <keyword> [--all] [--mode keyword|bm25] [--limit N]\n" +
            "  vt search --like <id> --mode bm25 [--all] [--limit N]"
          );
          process.exitCode = 1;
          return;
        }
        await cmdSearch(config, {
          keyword: positional[0],
          like: typeof args["like"] === "string" ? args["like"] : undefined,
          mode: typeof args["mode"] === "string" ? args["mode"].toLowerCase() : undefined,
          limit,
          all: args["all"] === true,
        });
        break;
      }

      case "stale": {
        const days = parsePositiveIntFlag(args["days"], "days");
        if (days === FLAG_INVALID) return;
        cmdStale(config, { days });
        break;
      }

      case "show":
        if (!positional[0]) {
          console.error("Usage: vt show <id-or-substring>");
          process.exitCode = 1;
          return;
        }
        cmdShow(config, { identifier: positional[0] });
        break;

      case "done":
        if (!positional[0]) {
          console.error("Usage: vt done <id-or-substring>");
          process.exitCode = 1;
          return;
        }
        cmdDone(config, { identifier: positional[0] });
        break;

      case "start":
        if (!positional[0]) {
          console.error("Usage: vt start <id-or-substring>");
          process.exitCode = 1;
          return;
        }
        cmdStart(config, { identifier: positional[0] });
        break;

      case "edit":
        if (!positional[0]) {
          console.error("Usage: vt edit <id-or-substring> [--status S] [--priority P] [--tags t1,t2]");
          process.exitCode = 1;
          return;
        }
        cmdEdit(config, {
          identifier: positional[0],
          status: (args["status"] as string | undefined)?.toLowerCase(),
          priority: (args["priority"] as string | undefined)?.toLowerCase(),
          tags: args["tags"] as string | undefined,
        });
        break;

      case "archive":
        cmdArchive(config);
        break;

      case "tags":
        cmdTags(config);
        break;

      case "lint":
        cmdLint(config, {
          only: args["only"] as string | undefined,
          scope: args["scope"] as string | undefined,
          json: args["json"] === true,
          quiet: args["quiet"] === true,
          noSuggestions: args["no-suggestions"] === true,
        });
        break;

      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(errorMessage(err));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exitCode = 1;
});
