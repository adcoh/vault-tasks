import type { Config } from "../config.js";
import { formatSearchHits, formatTaskTable, sanitizeForDisplay, sortByPriority } from "../output.js";
import { searchTasks, similarTasks } from "../search/index.js";
import type { SearchMode } from "../search/types.js";
import { TaskStore } from "../store.js";

const VALID_MODES: ReadonlySet<string> = new Set(["keyword", "bm25"]);

export interface SearchArgs {
  keyword?: string;
  like?: string;
  mode?: string;
  limit?: number;
  all?: boolean;
}

export async function cmdSearch(config: Config, args: SearchArgs): Promise<void> {
  const store = new TaskStore(config);
  const includeArchived = args.all === true;

  const requestedMode = args.mode ?? "keyword";
  const mode = requestedMode.toLowerCase();
  if (!VALID_MODES.has(mode)) {
    throw new Error(
      `Invalid --mode '${sanitizeForDisplay(requestedMode)}'. Use: ${[...VALID_MODES].join(", ")}.`
    );
  }

  if (args.like !== undefined && args.keyword !== undefined) {
    throw new Error(
      "--like and a positional <keyword> cannot be combined. " +
      "Use --like <id> for similarity search, or <keyword> for query search."
    );
  }

  if (args.like !== undefined) {
    if (args.like === "") {
      throw new Error("--like requires a non-empty task id.");
    }
    if (mode === "keyword") {
      throw new Error(
        `--like requires --mode bm25. Keyword mode does substring matching, not task similarity. ` +
        `Try: vt search --like '${sanitizeForDisplay(args.like)}' --mode bm25`
      );
    }
    const target = store.findIncludingArchive(args.like);
    const hits = await similarTasks(store, target, {
      mode: mode as SearchMode,
      limit: args.limit,
      includeArchived,
    });
    if (hits.length === 0) {
      console.log(`No tasks similar to '${target.id} ${sanitizeForDisplay(target.title)}'.`);
      return;
    }
    console.log(formatSearchHits(hits));
    return;
  }

  if (!args.keyword) {
    throw new Error(
      "Usage:\n" +
      "  vt search <keyword> [--all] [--mode keyword|bm25] [--limit N]\n" +
      "  vt search --like <id> --mode bm25 [--all] [--limit N]"
    );
  }

  if (mode === "keyword") {
    // Preserve legacy CLI behavior: substring match + priority sort, no
    // result cap unless --limit is passed. Sort first, THEN slice — slicing
    // before the sort would silently drop high-priority matches that live in
    // higher-numbered files.
    const matches = store.search(args.keyword, includeArchived);
    if (matches.length === 0) {
      console.log(`No tasks matching '${sanitizeForDisplay(args.keyword)}'.`);
      return;
    }
    const sorted = sortByPriority(matches);
    const limited = args.limit !== undefined ? sorted.slice(0, args.limit) : sorted;
    console.log(formatTaskTable(limited));
    return;
  }

  const hits = await searchTasks(store, args.keyword, {
    mode: mode as SearchMode,
    limit: args.limit,
    includeArchived,
  });
  if (hits.length === 0) {
    console.log(`No tasks matching '${sanitizeForDisplay(args.keyword)}'.`);
    return;
  }
  console.log(formatSearchHits(hits));
}
