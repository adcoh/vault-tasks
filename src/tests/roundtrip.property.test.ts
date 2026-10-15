/**
 * Property tests for the frontmatter/task round trip: parse(write(x)) == x.
 *
 * Zero-dependency by design: a seeded PRNG + hand-rolled generators instead
 * of a property-testing library. Reproduce a failure with the seed printed in
 * the assertion message: `VT_PROP_SEED=<seed> npm test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";
import { parseFrontmatter, writeFrontmatter } from "../frontmatter.js";
import { TaskStore } from "../store.js";

const BASE_SEED = Number(process.env.VT_PROP_SEED ?? 0x5eed);
const RUNS = 300;

/** mulberry32 — tiny, fast, good enough for test-case generation. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fragments chosen to hit every quoting/escaping branch in frontmatter.ts:
// YAML specials, reserved literals, numbers, list/doc markers, CR/LF/CRLF,
// tabs, unicode (incl. whitespace that String#trim strips), wikilinks.
// biome-ignore format: one fragment per line would be 60 lines of noise
const FRAGMENTS = [
  "a", "b", "z", "Fix", "bug", "0", "7", " ", "  ", "\t", ":", ": ", "#", " #",
  "'", '"', "\\", "\\n", "-", "- ", "--", "---", "[", "]", "[]", "{", "}", ",",
  "|", ">", "!", "&", "*", "@", "?", "`", "%", "~", "\n", "\r", "\r\n",
  "true", "null", "No", "42", "-3.5", "0x1F", "1e5", "[[wiki link]]", "[a, b]",
  "é", "日本語", "🚀", "\u00a0", "\u2028", "\ufeff", "\u200b", "ﬁ",
];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function genString(r: () => number): string {
  const roll = r();
  if (roll < 0.08) return "";
  // ~5% long values (hundreds to thousands of chars).
  const n = roll > 0.95 ? 100 + Math.floor(r() * 400) : 1 + Math.floor(r() * 8);
  let s = "";
  for (let i = 0; i < n; i++) s += pick(r, FRAGMENTS);
  return s;
}

function genArray(r: () => number): string[] {
  const n = Math.floor(r() * 4);
  return Array.from({ length: n }, () => genString(r));
}

const KEY_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-";

function genKey(r: () => number): string {
  const first = pick(r, [..."abcdefghijklmnopqrstuvwxyz_"]);
  let k = first;
  const n = Math.floor(r() * 10);
  for (let i = 0; i < n; i++) k += pick(r, [...KEY_CHARS]);
  return k;
}

function genMeta(r: () => number): Record<string, string | string[]> {
  const meta: Record<string, string | string[]> = {};
  const n = Math.floor(r() * 7);
  for (let i = 0; i < n; i++) meta[genKey(r)] = r() < 0.3 ? genArray(r) : genString(r);
  return meta;
}

function genBody(r: () => number): string {
  const n = Math.floor(r() * 6);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(r() < 0.15 ? "---" : genString(r));
  return lines.join(r() < 0.5 ? "\n" : "\r\n");
}

/** Bodies are written as-is and normalised to LF on read. */
const lf = (s: string): string => s.replace(/\r+\n/g, "\n");

function forAll(name: string, prop: (r: () => number, seed: number) => void): void {
  it(`${name} (${RUNS} seeded cases)`, () => {
    for (let i = 0; i < RUNS; i++) {
      const seed = BASE_SEED + i;
      prop(prng(seed), seed);
    }
  });
}

describe("frontmatter round-trip property", () => {
  forAll("parseFrontmatter(writeFrontmatter(meta, body)) returns meta and body", (r, seed) => {
    const meta = genMeta(r);
    const body = genBody(r);
    const text = writeFrontmatter(meta, body);
    const parsed = parseFrontmatter(text);
    const ctx = `seed=${seed}\n${JSON.stringify(text)}`;
    assert.deepStrictEqual(parsed.meta, meta, ctx);
    assert.equal(parsed.body, lf(body), ctx);
  });

  forAll("rewriting a parsed file is idempotent (no diff churn on save)", (r, seed) => {
    const rewrite = (text: string): string => {
      const p = parseFrontmatter(text);
      return writeFrontmatter(p.meta, p.body);
    };
    const once = rewrite(writeFrontmatter(genMeta(r), genBody(r)));
    assert.equal(rewrite(once), once, `seed=${seed}`);
  });

  forAll("CRLF files parse identically to their LF form", (r, seed) => {
    const lfText = writeFrontmatter(genMeta(r), genBody(r)).replace(/\r/g, "");
    const crlf = lfText.replace(/\n/g, "\r\n");
    assert.deepStrictEqual(parseFrontmatter(crlf), parseFrontmatter(lfText), `seed=${seed}`);
  });
});

describe("task round-trip property (TaskStore)", () => {
  forAll("create → find returns the same title, tags, source and body", (r, seed) => {
    const dir = mkdtempSync(join(tmpdir(), "vt-prop-"));
    const store = new TaskStore(loadConfig(dir));
    // Empty title falls back to the filename stem by design; exclude it.
    const title = genString(r) || "t";
    const opts = { title, tags: genArray(r), source: genString(r), body: genBody(r) };
    const created = store.create(opts);
    const found = store.find(created.id);
    const ctx = `seed=${seed}\n${JSON.stringify(opts)}`;
    assert.equal(found.title, title, ctx);
    assert.deepStrictEqual(found.tags, opts.tags, ctx);
    assert.equal(found.source, opts.source, ctx);
    assert.equal(found.body, lf(opts.body), ctx);
  });

  forAll("update preserves unknown frontmatter fields (extraMeta)", (r, seed) => {
    const dir = mkdtempSync(join(tmpdir(), "vt-prop-"));
    const config = loadConfig(dir);
    const store = new TaskStore(config);
    const extra = genMeta(r);
    for (const k of ["title", "status", "priority", "tags", "created", "source"]) delete extra[k];
    const meta = { title: "x", status: "open", priority: "low", tags: [], ...extra };
    store.create({ title: "seed" }); // ensures backlog dir + id 0001 exists
    writeFileSync(join(config.backlogDir, "0002-prop.md"), writeFrontmatter(meta, "body\n"));
    store.update("0002", { priority: "high" });
    const found = store.find("0002");
    assert.deepStrictEqual(found.extraMeta, extra, `seed=${seed}\n${JSON.stringify(meta)}`);
    assert.equal(found.priority, "high");
  });
});
