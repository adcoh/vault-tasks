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
  search <keyword>      Search tasks by title and body
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

function main(): void {
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
    console.error((err as Error).message);
    process.exitCode = 1;
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
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  // install-skills needs vault root but not necessarily a full config
  if (command === "install-skills") {
    cmdInstallSkills(config, {
      install: args["install"] === true,
      list: args["list"] === true,
      update: args["update"] === true,
    });
    return;
  }

  try {
    switch (command) {
      case "new":
        if (!positional[0]) {
          console.error("Usage: vt new <title> [--priority P] [--tags t1,t2] [--source S] [--commit]");
          process.exitCode = 1;
          return;
        }
        cmdNew(config, {
          title: positional[0],
          priority: (args["priority"] as string | undefined)?.toLowerCase(),
          tags: args["tags"] as string | undefined,
          source: args["source"] as string | undefined,
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

      case "search":
        if (!positional[0]) {
          console.error("Usage: vt search <keyword> [--all]");
          process.exitCode = 1;
          return;
        }
        cmdSearch(config, {
          keyword: positional[0],
          all: args["all"] === true,
        });
        break;

      case "stale": {
        let days: number | undefined;
        if (args["days"] !== undefined) {
          days = parseInt(args["days"] as string, 10);
          if (isNaN(days) || days < 1) {
            console.error("Error: --days must be a positive integer");
            process.exitCode = 1;
            return;
          }
        }
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

      case "lint": {
        // --only and --scope are value-bearing flags. parseArgs sets them to
        // `true` if the user passes the flag without a value (e.g. `--only`
        // followed by another flag or end-of-args), so coerce explicitly
        // rather than asserting the type away.
        const onlyArg = args["only"];
        const scopeArg = args["scope"];
        if (onlyArg === true) {
          console.error("Error: --only requires a value (broken|orphans|stale|drift)");
          process.exitCode = 2;
          return;
        }
        if (scopeArg === true) {
          console.error("Error: --scope requires a value (a directory)");
          process.exitCode = 2;
          return;
        }
        cmdLint(config, {
          only: typeof onlyArg === "string" ? onlyArg : undefined,
          scope: typeof scopeArg === "string" ? scopeArg : undefined,
          json: args["json"] === true,
          quiet: args["quiet"] === true,
          noSuggestions: args["no-suggestions"] === true,
        });
        break;
      }

      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}

main();
