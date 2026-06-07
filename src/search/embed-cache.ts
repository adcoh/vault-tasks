import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Task } from "../task.js";
import type { Embedder } from "./embeddings.js";

/**
 * On-disk cache of task embeddings, stored at
 * `<vaultRoot>/.vault-tasks/embeddings.json`.
 *
 * Keyed by `sha256(provider \n model \n embeddedText)`, so a change to the
 * provider, the model, or a task's content is a cache miss that re-embeds only
 * that entry. The header records provider/model/dimensions; a provider or model
 * change discards the whole file rather than mixing incompatible vectors.
 *
 * Embeddings are derived data — a corrupt or unreadable file is treated as an
 * empty cache and silently rebuilt, never a hard failure.
 */

const CACHE_VERSION = 1;

// Bound the text embedded per task, mirroring BM25's MAX_DOC_CHARS. A multi-MB
// task body (pasted log, minified blob) would otherwise inflate every request.
const MAX_TEXT_CHARS = 2_000_000;

interface CacheFile {
  version: number;
  provider: string;
  model: string;
  dimensions: number | null;
  entries: Record<string, number[]>;
}

export class EmbedCache {
  private readonly cachePath: string;

  constructor(
    private readonly vaultRoot: string,
    private readonly provider: string,
    private readonly model: string,
    private readonly expectedDim: number | null = null
  ) {
    const dir = join(vaultRoot, ".vault-tasks");
    this.cachePath = join(dir, "embeddings.json");
    // Defense-in-depth: the path is constructed here, but never let it escape the
    // vault root (e.g. if vaultRoot were ever derived from untrusted input).
    if (relative(vaultRoot, this.cachePath).startsWith("..")) {
      throw new Error("embedding cache path escapes the vault root");
    }
  }

  /**
   * Return `{ task, vector }` for every input task, in input order. Cache hits
   * are served from disk; misses are embedded in a single batched call and the
   * file is rewritten (pruned to the current corpus) when anything changed.
   */
  async getOrCompute(
    tasks: ReadonlyArray<Task>,
    embedder: Embedder
  ): Promise<Array<{ task: Task; vector: number[] }>> {
    if (tasks.length === 0) return [];

    const loaded = this.load();
    const keys = tasks.map((t) => this.keyFor(t));

    const missIndices: number[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (!loaded.has(keys[i])) missIndices.push(i);
    }

    if (missIndices.length > 0) {
      const missTexts = missIndices.map((i) => embedText(tasks[i]));
      const vectors = await embedder.embed(missTexts);
      if (vectors.length !== missIndices.length) {
        throw new Error(
          `Embedder returned ${vectors.length} vectors for ${missIndices.length} inputs.`
        );
      }
      for (let m = 0; m < missIndices.length; m++) {
        loaded.set(keys[missIndices[m]], validateVector(vectors[m], this.expectedDim));
      }
    }

    const result = tasks.map((task, i) => {
      const vector = loaded.get(keys[i]);
      if (!vector) {
        // Unreachable: every key was either loaded or just computed above.
        throw new Error("internal: embedding missing after compute");
      }
      return { task, vector };
    });

    // Prune to the current corpus and persist when the on-disk set would differ.
    const currentKeys = new Set(keys);
    const hadStale = loaded.size !== currentKeys.size;
    if (missIndices.length > 0 || hadStale) {
      const pruned = new Map<string, number[]>();
      for (const k of currentKeys) {
        const v = loaded.get(k);
        if (v) pruned.set(k, v);
      }
      this.persist(pruned, result[0]?.vector.length ?? null);
    }

    return result;
  }

  private keyFor(task: Task): string {
    return createHash("sha256")
      .update(`${this.provider}\n${this.model}\n${embedText(task)}`)
      .digest("hex");
  }

  /** Load valid entries for this provider/model, or an empty map. Never throws. */
  private load(): Map<string, number[]> {
    const map = new Map<string, number[]>();
    if (!existsSync(this.cachePath)) return map;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.cachePath, "utf-8").replace(/\r\n/g, "\n"));
    } catch {
      return map; // corrupt JSON — rebuild from scratch
    }
    if (typeof parsed !== "object" || parsed === null) return map;
    const file = parsed as Partial<CacheFile>;
    if (file.version !== CACHE_VERSION) return map;
    if (file.provider !== this.provider || file.model !== this.model) return map;
    if (this.expectedDim !== null && file.dimensions != null && file.dimensions !== this.expectedDim) {
      return map; // header disagrees with configured dims — discard
    }
    const entries = file.entries;
    if (typeof entries !== "object" || entries === null) return map;

    const headerDim = typeof file.dimensions === "number" ? file.dimensions : null;
    for (const [key, value] of Object.entries(entries)) {
      const vec = tryVector(value, this.expectedDim ?? headerDim);
      if (vec) map.set(key, vec);
    }
    return map;
  }

  private persist(entries: Map<string, number[]>, dimensions: number | null): void {
    const dir = dirname(this.cachePath);
    mkdirSync(dir, { recursive: true });
    const payload: CacheFile = {
      version: CACHE_VERSION,
      provider: this.provider,
      model: this.model,
      dimensions,
      entries: Object.fromEntries(entries),
    };
    // Atomic write: a crash mid-write must not leave a truncated cache that the
    // loader would discard (slow) — write to a temp sibling, then rename.
    const tmp = `${this.cachePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload), "utf-8");
    try {
      renameSync(tmp, this.cachePath);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort cleanup */
      }
      throw err;
    }
  }
}

function embedText(task: Task): string {
  const text = `${task.title}\n${task.tags.join(" ")}\n${task.body}`;
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

/** Validate a freshly computed vector — a violation here is a bug, so throw. */
function validateVector(value: number[], expectedDim: number | null): number[] {
  const vec = tryVector(value, expectedDim);
  if (!vec) throw new Error("embedder produced an invalid vector (empty or non-finite).");
  return vec;
}

/** Coerce unknown disk/wire data to a clean number[], or null if invalid. */
function tryVector(value: unknown, expectedDim: number | null): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (expectedDim !== null && value.length !== expectedDim) return null;
  const out = new Array<number>(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = value[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}
