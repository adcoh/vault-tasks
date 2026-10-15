# Retrieval eval

Measures `vt search` ranking quality so search changes (stemming, BM25F,
default mode, embedding models) are decided on numbers, not anecdotes.

- `fixture/` — synthetic vault: 60 tasks from a made-up habit-tracker backlog
  (auth, sync, billing, CI, infra…), with deliberate topic overlap and
  near-duplicates. No private content.
- `queries.json` — 53 labelled queries, each with its expected task file(s).
  Written as paraphrases of how someone would *remember* the task ("download
  my history into excel" → `0017-export-data-as-csv.md`), not title copies.
- `run.mjs` — runs every query through `searchTasks()` from `dist/` and
  reports recall@1, recall@5 (|relevant ∩ top-k| / |relevant|) and MRR.
- `baseline.json` — the BM25 numbers the CI gate compares against.

```sh
npm run build
npm run eval:retrieval                     # keyword + bm25, offline
npm run eval:retrieval -- --check          # CI gate (see below)
npm run eval:retrieval -- --provider transformers --model Xenova/all-MiniLM-L6-v2
                                           # + semantic and hybrid, in-process
```

The embedding run needs the optional `@huggingface/transformers` package and
downloads the model (~23 MB, free, from the Hugging Face hub) on first use;
after that it runs offline. Any configured provider works (`--provider ollama
--model nomic-embed-text` against a local Ollama).

## Baseline (2026-10-15, vault-tasks 0.6.0)

| mode | recall@1 | recall@5 | MRR |
|---|---|---|---|
| keyword | 0.000 | 0.000 | 0.000 |
| bm25 | 0.811 | 0.868 | 0.840 |
| semantic (all-MiniLM-L6-v2, in-process) | 0.934 | **1.000** | 0.972 |
| hybrid (bm25 + semantic, RRF) | 0.887 | 0.972 | 0.919 |

- **`keyword` scores zero by construction**: it is a whole-query substring
  match, and multi-word paraphrases never occur verbatim. It is the CLI default.
- **BM25 misses are vocabulary gaps, not morphology gaps**: excel/CSV,
  toggles/feature flags, exception monitoring/Sentry, paging/alerting, night
  theme/dark mode (where "night" pulls *nightly* backups to the top). A
  stemmer (backlog `0004`) could plausibly rescue at most one of the 7 misses
  (remind → reminders) and would strengthen the night/nightly confusion.
  (Reasoned from the miss list, not measured — implement it behind a flag
  and re-run this eval to confirm.)
- **Hybrid is worse than semantic alone here**: RRF lets BM25's confident
  wrong answers outvote the embedding's right ones.

## Target and gate

- **Target: recall@5 ≥ 0.90 for the default offline mode.** That is the bar any
  future lexical search change (BM25F, synonyms, query expansion) must clear.
- **CI gate**: `npm run eval:retrieval -- --check` fails if BM25 recall@5 falls
  below `baseline − tolerance` (0.868 − 0.02; one query is ≈ 0.019). If a
  change *intentionally* moves the numbers, update `baseline.json` and the
  table above in the same PR.

## Caveats

- One author wrote both the tasks and the queries, so the labels share that
  author's vocabulary. Treat absolute numbers as optimistic; deltas between
  modes and between commits are what this measures well.
- 60 documents is small. BM25's IDF and RRF fusion both behave differently on
  vaults with thousands of tasks.
- Add a query whenever a real "why didn't search find X?" report comes in;
  that is the cheapest way to make the set less author-biased.
