#!/usr/bin/env node
// Read-only snapshot of vault-tasks' outcomes as JSON on stdout, for the
// /state-of-vt skill: npm + PyPI downloads, GitHub issues/PRs/dependents,
// CI health, retrieval-eval numbers, and backlog staleness.
//
//   node scripts/state-of-vt.mjs > /tmp/state.json
//
// Every source fails soft into `{ "error": "..." }` so one missing tool (no
// `gh` auth, offline) still yields the rest. Writes nothing to the repo.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "vault-tasks";
const REPO = "adcoh/vault-tasks";
const DAY = 86_400_000;

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const today = Date.now();

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: "utf-8", timeout: 60_000 }).trim();
}
const gh = (args) => JSON.parse(run("gh", args));

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

async function soft(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: String(err.message ?? err).split("\n")[0] };
  }
}

/** Sum npm downloads over [start, end] (inclusive, YYYY-MM-DD). */
async function npmRange(start, end) {
  const j = await getJson(`https://api.npmjs.org/downloads/range/${start}:${end}/${PKG}`);
  return j.downloads.reduce((n, d) => n + d.downloads, 0);
}

const npm = soft(async () => {
  const end = isoDay(today - DAY); // today's numbers are partial
  return {
    last_7d: await npmRange(isoDay(today - 7 * DAY), end),
    last_30d: await npmRange(isoDay(today - 30 * DAY), end),
    prior_30d: await npmRange(isoDay(today - 60 * DAY), isoDay(today - 31 * DAY)),
  };
});

const pypi = soft(async () => {
  const recent = (await getJson(`https://pypistats.org/api/packages/${PKG}/recent`)).data;
  // `overall?mirrors=false` excludes bandersnatch-style mirror traffic.
  const overall = (await getJson(`https://pypistats.org/api/packages/${PKG}/overall?mirrors=false`))
    .data;
  const cut30 = isoDay(today - 30 * DAY);
  const cut60 = isoDay(today - 60 * DAY);
  const sum = (from, to) =>
    overall.filter((d) => d.date >= from && d.date < to).reduce((n, d) => n + d.downloads, 0);
  return {
    last_7d: recent.last_week,
    last_30d_no_mirrors: sum(cut30, "9999"),
    prior_30d_no_mirrors: sum(cut60, cut30),
  };
});

const github = soft(async () => {
  const since = isoDay(today - 30 * DAY);
  const repo = gh(["api", `repos/${REPO}`]);
  const issueFields = "number,title,createdAt,updatedAt,labels,comments,author";
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    open_issues: gh([
      "issue",
      "list",
      "-R",
      REPO,
      "--state",
      "open",
      "-L",
      "50",
      "--json",
      issueFields,
    ]),
    issues_closed_30d: gh([
      "issue",
      "list",
      "-R",
      REPO,
      "--state",
      "closed",
      "--search",
      `closed:>=${since}`,
      "-L",
      "50",
      "--json",
      "number,title,closedAt",
    ]),
    open_prs: gh([
      "pr",
      "list",
      "-R",
      REPO,
      "--state",
      "open",
      "-L",
      "50",
      "--json",
      "number,title,createdAt,isDraft,author",
    ]),
    prs_merged_30d: gh([
      "pr",
      "list",
      "-R",
      REPO,
      "--state",
      "merged",
      "--search",
      `merged:>=${since}`,
      "-L",
      "50",
      "--json",
      "number,title,mergedAt",
    ]),
    // Owner-only endpoints; soft-fail independently.
    traffic_views_14d: await soft(async () =>
      gh(["api", `repos/${REPO}/traffic/views`, "--jq", "{count,uniques}"])
    ),
    traffic_clones_14d: await soft(async () =>
      gh(["api", `repos/${REPO}/traffic/clones`, "--jq", "{count,uniques}"])
    ),
  };
});

// GitHub has no dependents API; these are two rough proxies.
const dependents = soft(async () => {
  const search = await getJson(`https://registry.npmjs.org/-/v1/search?text=${PKG}&size=5`);
  const self = search.objects.find((o) => o.package.name === PKG);
  const code = await soft(async () =>
    gh([
      "search",
      "code",
      `"${PKG}"`,
      "--filename",
      "package.json",
      "-L",
      "50",
      "--json",
      "repository",
    ])
      .map((r) => r.repository.nameWithOwner)
      .filter((n) => n !== REPO)
  );
  return { npm_dependents: self?.dependents ?? null, github_package_json_mentions: code };
});

const ci = soft(async () => {
  const runs = gh([
    "run",
    "list",
    "-R",
    REPO,
    "--workflow",
    "ci.yml",
    "--branch",
    "main",
    "-L",
    "10",
    "--json",
    "conclusion,createdAt,displayTitle,url",
  ]);
  const done = runs.filter((r) => r.conclusion);
  return {
    main_last_10: done.map((r) => ({
      conclusion: r.conclusion,
      at: r.createdAt,
      title: r.displayTitle,
    })),
    main_pass_rate: done.length
      ? done.filter((r) => r.conclusion === "success").length / done.length
      : null,
  };
});

const release = soft(async () => {
  const tag = run("git", ["describe", "--tags", "--abbrev=0", "origin/main"]);
  const log = run("git", ["log", "--oneline", `${tag}..origin/main`]);
  return {
    latest_tag: tag,
    tag_date: run("git", ["log", "-1", "--format=%cs", tag]),
    unreleased_commits: log ? log.split("\n") : [],
  };
});

const evals = soft(async () => {
  const out = JSON.parse(
    run(process.execPath, [join(root, "evals", "retrieval", "run.mjs"), "--json"])
  );
  const baseline = JSON.parse(
    readFileSync(join(root, "evals", "retrieval", "baseline.json"), "utf-8")
  );
  return {
    queries: out.queries,
    results: out.results.map(({ misses, ...r }) => ({ ...r, misses: misses.length })),
    baseline,
  };
});

const backlog = soft(async () => {
  const dir = join(root, "50-backlog");
  return readdirSync(dir)
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf-8");
      const field = (k) => text.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
      const created = field("created");
      const age = /^\d{4}-\d{2}-\d{2}$/.test(created)
        ? Math.floor((today - Date.parse(created)) / DAY)
        : null;
      return {
        file: f,
        title: field("title"),
        status: field("status"),
        priority: field("priority"),
        age_days: age,
      };
    });
});

const snapshot = {
  generated: new Date(today).toISOString(),
  npm: await npm,
  pypi: await pypi,
  github: await github,
  dependents: await dependents,
  ci: await ci,
  release: await release,
  eval: await evals,
  backlog: await backlog,
};
console.log(JSON.stringify(snapshot, null, 2));
