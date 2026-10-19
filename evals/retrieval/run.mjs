#!/usr/bin/env node
// Retrieval eval for `vt search`: recall@1, recall@5 and MRR over labelled
// paraphrase queries against the synthetic fixture vault in ./fixture.
//
//   npm run eval:retrieval                      # keyword + bm25 (offline)
//   npm run eval:retrieval -- --check           # fail if bm25 recall@5 < baseline - tolerance
//   npm run eval:retrieval -- --provider transformers --model Xenova/all-MiniLM-L6-v2
//                                               # adds semantic + hybrid
//
// Runs against dist/ (build first). The fixture is copied to a temp dir so the
// embedding cache never lands in the repo.

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(here, "..", "..", "dist", "index.js")).href).catch(
  (err) => {
    console.error(`eval: run 'npm run build' first (${err.message})`);
    process.exit(1);
  }
);
const { TaskStore, createEmbedder, loadConfig, searchTasks } = lib;

const { values: args } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    provider: { type: "string" },
    model: { type: "string" },
  },
});

const K = [1, 5];
const queries = JSON.parse(readFileSync(join(here, "queries.json"), "utf-8"));
const baseline = JSON.parse(readFileSync(join(here, "baseline.json"), "utf-8"));

/** Recall@k is |relevant ∩ top-k| / |relevant|; MRR uses the first relevant hit. */
function score(ranked, expected) {
  const out = {};
  for (const k of K) {
    const top = new Set(ranked.slice(0, k));
    out[`recall@${k}`] = expected.filter((e) => top.has(e)).length / expected.length;
  }
  const first = ranked.findIndex((r) => expected.includes(r));
  out.mrr = first === -1 ? 0 : 1 / (first + 1);
  return out;
}

async function evalMode(store, mode, embedder) {
  const totals = { "recall@1": 0, "recall@5": 0, mrr: 0 };
  const misses = [];
  for (const { query, expected } of queries) {
    // Rank every fixture task so MRR is unqualified, not MRR@10.
    const hits = await searchTasks(store, query, {
      mode,
      limit: Number.MAX_SAFE_INTEGER,
      embedder,
    });
    const ranked = hits.map((h) => basename(h.task.filePath));
    const s = score(ranked, expected);
    for (const key of Object.keys(totals)) totals[key] += s[key];
    if (s["recall@5"] < 1) misses.push({ query, expected, top3: ranked.slice(0, 3) });
  }
  const n = queries.length;
  const round = (x) => Math.round((x / n) * 1000) / 1000;
  return {
    mode,
    "recall@1": round(totals["recall@1"]),
    "recall@5": round(totals["recall@5"]),
    mrr: round(totals.mrr),
    misses,
  };
}

const vault = mkdtempSync(join(tmpdir(), "vt-eval-"));
let results;
try {
  cpSync(join(here, "fixture"), vault, { recursive: true });
  const store = new TaskStore(loadConfig(vault));
  const modes = ["keyword", "bm25"];
  let embedder;
  if (args.provider) {
    if (!args.model) {
      console.error("eval: --provider needs --model, e.g. --model Xenova/all-MiniLM-L6-v2");
      process.exit(2);
    }
    embedder = createEmbedder({
      ...store.config.search,
      embeddingProvider: args.provider,
      embeddingModel: args.model,
    });
    modes.push("semantic", "hybrid");
  }
  results = [];
  for (const mode of modes) results.push(await evalMode(store, mode, embedder));
} finally {
  rmSync(vault, { recursive: true, force: true });
}

if (args.json) {
  console.log(JSON.stringify({ queries: queries.length, results }, null, 2));
} else {
  const label = args.provider ? ` (embeddings: ${args.provider} ${args.model})` : "";
  console.log(`retrieval eval — ${queries.length} queries${label}\n`);
  console.log("mode       recall@1  recall@5  MRR");
  for (const r of results) {
    const f = (x) => x.toFixed(3).padStart(8);
    console.log(`${r.mode.padEnd(9)} ${f(r["recall@1"])}  ${f(r["recall@5"])}  ${f(r.mrr)}`);
  }
  const bm = results.find((r) => r.mode === "bm25");
  console.log(`\nbm25 misses at @5 (${bm.misses.length}):`);
  for (const m of bm.misses)
    console.log(`  "${m.query}" → want ${m.expected[0]}; got ${m.top3[0] ?? "-"}`);
}

if (args.check) {
  const bm = results.find((r) => r.mode === "bm25");
  const floor = baseline.bm25["recall@5"] - baseline.tolerance;
  if (bm["recall@5"] < floor) {
    console.error(
      `eval: bm25 recall@5 ${bm["recall@5"]} is below the floor ${floor.toFixed(3)} ` +
        `(baseline ${baseline.bm25["recall@5"]} - tolerance ${baseline.tolerance}). ` +
        `Fix the regression, or if the drop is intended, update evals/retrieval/baseline.json and README.md.`
    );
    process.exit(1);
  }
  console.log(`\ncheck: bm25 recall@5 ${bm["recall@5"]} ≥ floor ${floor.toFixed(3)} — ok`);
}
