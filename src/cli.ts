#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { cmdArchive } from "./commands/archive.js";
import { cmdDone } from "./commands/done.js";
import { cmdEdit } from "./commands/edit.js";
import { cmdInit } from "./commands/init.js";
import { cmdInstallSkills } from "./commands/install-skills.js";
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
  edit <id>             Edit task fields
  archive               Move completed tasks to archive
  tags                  List all tags in use
  init                  Initialize vault-tasks in current directory
  install-skills        Install Claude Code skills and rules

Options (vary by command):
  --priority, -p        high, medium, or low
  --tags, -t            Comma-separated tags
  --source, -s          Where this was noticed
  --commit              Git commit after creating
  --status              Filter or set status
  --tag                 Filter by tag
  --include-done, -a    Include done/wont-do tasks
  --include-archived    Include archived tasks in search
  --days, -d            Stale threshold in days (default: 14)
  --all                 Install all skills
  --list                List available skills
  --update              Overwrite existing skill files
`;

function parseArgs(argv: string[]): { command: string; args: Record<string, string | boolean> ; positional: string[] } {
  const command = argv[0] ?? "";
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i++;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const short: Record<string, string> = {
        p: "priority",
        t: "tags",
        s: "source",
        a: "include-done",
        d: "days",
      };
      const key = short[arg[1]] ?? arg[1];
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i++;
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

  if (rawArgs.length === 0 || rawArgs[0] === "--help" || rawArgs[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const { command, args, positional } = parseArgs(rawArgs);

  // init doesn't need config
  if (command === "init") {
    cmdInit({ dir: positional[0] });
    return;
  }

  // install-skills needs vault root but not necessarily a full config
  if (command === "install-skills") {
    const config = loadConfig();
    cmdInstallSkills(config.vaultRoot, {
      all: args["all"] === true,
      list: args["list"] === true,
      update: args["update"] === true,
    });
    return;
  }

  const config = loadConfig();

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
          priority: args["priority"] as string | undefined,
          tags: args["tags"] as string | undefined,
          source: args["source"] as string | undefined,
          commit: args["commit"] === true,
        });
        break;

      case "list":
        cmdList(config, {
          status: args["status"] as string | undefined,
          priority: args["priority"] as string | undefined,
          tag: args["tag"] as string | undefined,
          includeDone: args["include-done"] === true,
        });
        break;

      case "search":
        if (!positional[0]) {
          console.error("Usage: vt search <keyword> [--include-archived]");
          process.exitCode = 1;
          return;
        }
        cmdSearch(config, {
          keyword: positional[0],
          includeArchived: args["include-archived"] === true,
        });
        break;

      case "stale":
        cmdStale(config, {
          days: args["days"] ? parseInt(args["days"] as string, 10) : undefined,
        });
        break;

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
          console.error("Usage: vt edit <id-or-substring> [--status S] [--priority P]");
          process.exitCode = 1;
          return;
        }
        cmdEdit(config, {
          identifier: positional[0],
          status: args["status"] as string | undefined,
          priority: args["priority"] as string | undefined,
        });
        break;

      case "archive":
        cmdArchive(config);
        break;

      case "tags":
        cmdTags(config);
        break;

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
