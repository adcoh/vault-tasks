import type { EmbeddingProvider, SearchConfig } from "../config.js";

/**
 * Embedding generation for semantic/hybrid search.
 *
 * Local-first: the default provider talks to a local Ollama server over HTTP
 * (Node's global `fetch`), so no task text leaves the machine and no API key is
 * required. Three transports are supported:
 *
 *  - `ollama`  — native `POST {endpoint}/api/embed` → `{ embeddings: number[][] }`
 *  - OpenAI shape — `POST {endpoint}/v1/embeddings` → `{ data: [{ embedding, index }] }`
 *    (lmstudio, llamacpp, openai-compatible, and the cloud providers)
 *  - `transformers` — runs weights IN-PROCESS via the optional dependency
 *    `@huggingface/transformers`, loaded with a dynamic `import()` only when the
 *    provider is selected. It is never imported on any other path, so the core
 *    install stays zero *required* dependencies.
 *
 * Cloud providers read their API key from `process.env[embeddingApiKeyEnv]`; the
 * key value is never read from or written to config or disk.
 */

interface ProviderSpec {
  shape: "ollama" | "openai" | "transformers";
  defaultEndpoint: string;
  embedPath: string;
  requiresKey: boolean;
  /** Human label used in error messages and the "how to start it" hint. */
  label: string;
  /** Shown when the server is unreachable (local providers only). */
  startHint?: string;
}

const PROVIDER_SPECS: Record<EmbeddingProvider, ProviderSpec> = {
  ollama: {
    shape: "ollama",
    defaultEndpoint: "http://localhost:11434",
    embedPath: "/api/embed",
    requiresKey: false,
    label: "Ollama",
    startHint: "start it with `ollama serve` and `ollama pull <model>`",
  },
  lmstudio: {
    shape: "openai",
    defaultEndpoint: "http://localhost:1234",
    embedPath: "/v1/embeddings",
    requiresKey: false,
    label: "LM Studio",
    startHint: "start the LM Studio local server and load an embedding model",
  },
  llamacpp: {
    shape: "openai",
    defaultEndpoint: "http://localhost:8080",
    embedPath: "/v1/embeddings",
    requiresKey: false,
    label: "llama.cpp",
    startHint: "run `llama-server --embeddings -m <model.gguf>`",
  },
  "openai-compatible": {
    shape: "openai",
    defaultEndpoint: "",
    embedPath: "/v1/embeddings",
    requiresKey: false,
    label: "OpenAI-compatible server",
    startHint: "set [search] embedding_endpoint to your server URL",
  },
  openai: {
    shape: "openai",
    defaultEndpoint: "https://api.openai.com",
    embedPath: "/v1/embeddings",
    requiresKey: true,
    label: "OpenAI",
  },
  voyage: {
    shape: "openai",
    defaultEndpoint: "https://api.voyageai.com",
    embedPath: "/v1/embeddings",
    requiresKey: true,
    label: "Voyage AI",
  },
  gemini: {
    shape: "openai",
    defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    embedPath: "/embeddings",
    requiresKey: true,
    label: "Gemini",
  },
  transformers: {
    shape: "transformers",
    defaultEndpoint: "",
    embedPath: "",
    requiresKey: false,
    label: "in-process transformers",
  },
};

// Cap on inputs per HTTP request. The corpus is embedded miss-only by the cache,
// but a first run on a large vault would otherwise POST every task in one body.
// Chunking bounds request size and per-request latency.
const MAX_BATCH = 64;

// Per-request timeout for embedding HTTP calls. Without it, a blackholed
// endpoint (no response, no TCP reset) leaves the CLI hanging until the OS
// socket timeout — minutes — with no actionable feedback.
const REQUEST_TIMEOUT_MS = 30_000;

export interface Embedder {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  /**
   * Embed each input string into a vector. Output length and order match the
   * input. Throws an actionable error on transport/shape failures.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/** Build an Embedder from resolved search config. Pure/synchronous — any network
 *  or model load is deferred to the first `embed()` call. */
export function createEmbedder(search: SearchConfig): Embedder {
  const provider = search.embeddingProvider;
  const spec = PROVIDER_SPECS[provider];
  const model = search.embeddingModel;
  const expectedDim = search.embeddingDimensions;

  if (spec.shape === "transformers") {
    return makeTransformersEmbedder(provider, model, expectedDim);
  }

  const endpoint = (search.embeddingEndpoint || spec.defaultEndpoint).replace(/\/+$/, "");
  if (!endpoint) {
    throw new Error(
      `Provider '${provider}' has no endpoint — set [search] embedding_endpoint to your server URL.`
    );
  }

  let apiKey = "";
  if (spec.requiresKey || search.embeddingApiKeyEnv) {
    const envName = search.embeddingApiKeyEnv;
    if (!envName) {
      throw new Error(
        `Provider '${provider}' needs an API key. Set [search] embedding_api_key_env ` +
        `to the NAME of an environment variable holding the key.`
      );
    }
    apiKey = process.env[envName] ?? "";
    if (!apiKey && spec.requiresKey) {
      throw new Error(
        `Provider '${provider}' needs an API key, but environment variable ` +
        `$${envName} is empty or unset. Export it and retry.`
      );
    }
  }

  const url = endpoint + spec.embedPath;
  const embedBatch =
    spec.shape === "ollama"
      ? (texts: string[]) => ollamaEmbed(url, model, texts, spec, expectedDim)
      : (texts: string[]) => openAiEmbed(url, model, texts, apiKey, spec, expectedDim);

  return {
    provider,
    model,
    embed: (texts) => embedInBatches(texts, embedBatch),
  };
}

async function embedInBatches(
  texts: string[],
  embedBatch: (batch: string[]) => Promise<number[][]>
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const vectors = await embedBatch(batch);
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding server returned ${vectors.length} vectors for ${batch.length} inputs.`
      );
    }
    out.push(...vectors);
  }
  return out;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, spec: ProviderSpec): Promise<unknown> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const hint = spec.startHint ? ` — ${spec.startHint}` : "";
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${spec.label} timed out after ${REQUEST_TIMEOUT_MS / 1000}s at ${url}${hint}. ` +
        `Check the endpoint is reachable, or set [search] embedding_provider.`
      );
    }
    throw new Error(
      `${spec.label} not reachable at ${url}${hint}, or set [search] embedding_provider. ` +
      `(${(err as Error).message})`
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* body unreadable — status alone is the diagnostic */
    }
    throw new Error(
      `${spec.label} embedding request failed: HTTP ${res.status} ${res.statusText}` +
      `${detail ? ` — ${detail}` : ""}`
    );
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`${spec.label} returned a non-JSON response: ${(err as Error).message}`);
  }
}

/** Validate one vector from a server response. No `as` casts on wire data. */
function coerceVector(value: unknown, provider: string, expectedDim: number | null): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Provider '${provider}' returned a malformed embedding (not a non-empty array).`);
  }
  const vec = new Array<number>(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = value[i];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`Provider '${provider}' returned a non-finite value in an embedding.`);
    }
    vec[i] = n;
  }
  if (expectedDim !== null && vec.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: model returned ${vec.length}, but [search] ` +
      `embedding_dimensions is ${expectedDim}. Update or remove that setting.`
    );
  }
  return vec;
}

async function ollamaEmbed(
  url: string,
  model: string,
  texts: string[],
  spec: ProviderSpec,
  expectedDim: number | null
): Promise<number[][]> {
  const json = await postJson(url, { model, input: texts }, {}, spec);
  if (typeof json !== "object" || json === null || !("embeddings" in json)) {
    throw new Error(`Ollama response missing 'embeddings'. Is '${model}' an embedding model?`);
  }
  const embeddings = (json as { embeddings: unknown }).embeddings;
  if (!Array.isArray(embeddings)) {
    throw new Error("Ollama 'embeddings' field is not an array.");
  }
  return embeddings.map((e) => coerceVector(e, "ollama", expectedDim));
}

async function openAiEmbed(
  url: string,
  model: string,
  texts: string[],
  apiKey: string,
  spec: ProviderSpec,
  expectedDim: number | null
): Promise<number[][]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  const json = await postJson(url, { model, input: texts }, headers, spec);
  if (typeof json !== "object" || json === null || !("data" in json)) {
    throw new Error(`${spec.label} response missing 'data'. Is '${model}' an embedding model?`);
  }
  const data = (json as { data: unknown }).data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(
      `${spec.label} returned ${Array.isArray(data) ? data.length : "no"} embeddings for ${texts.length} inputs.`
    );
  }
  // Order by the response's `index` field when present; OpenAI does not promise
  // input order. Fall back to array position when index is absent/invalid.
  const out: number[][] = new Array(data.length);
  for (let pos = 0; pos < data.length; pos++) {
    const item = data[pos];
    if (typeof item !== "object" || item === null || !("embedding" in item)) {
      throw new Error(`${spec.label} response item ${pos} has no 'embedding'.`);
    }
    const rawIndex = (item as { index?: unknown }).index;
    const idx = Number.isInteger(rawIndex) && (rawIndex as number) >= 0 && (rawIndex as number) < data.length
      ? (rawIndex as number)
      : pos;
    out[idx] = coerceVector((item as { embedding: unknown }).embedding, spec.label, expectedDim);
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] === undefined) {
      throw new Error(`${spec.label} returned duplicate or missing indices in 'data'.`);
    }
  }
  return out;
}

/**
 * In-process embedder backed by the OPTIONAL `@huggingface/transformers` package.
 * The pipeline is built lazily on first use and cached for the embedder's life.
 */
function makeTransformersEmbedder(
  provider: EmbeddingProvider,
  model: string,
  expectedDim: number | null
): Embedder {
  // Typed as a thunk so the heavy pipeline loads once. `any` is unavoidable: the
  // dependency is optional and absent from the type graph, but its output is
  // validated through coerceVector below before reaching the rest of the system.
  let pipelinePromise: Promise<(text: string, opts: unknown) => Promise<unknown>> | null = null;

  async function getPipeline() {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
      let mod: { pipeline: (task: string, model: string) => Promise<unknown> };
      try {
        // Indirection via a variable defeats TS's static module resolution so a
        // missing optional dep is a runtime error we can phrase, not a build error.
        const moduleName = "@huggingface/transformers";
        mod = (await import(moduleName)) as typeof mod;
      } catch (err) {
        throw new Error(
          `Provider 'transformers' needs the optional package — run ` +
          `\`npm i @huggingface/transformers\`, or switch [search] embedding_provider ` +
          `to 'ollama'. (${(err as Error).message})`
        );
      }
      const pipe = (await mod.pipeline("feature-extraction", model)) as (
        text: string,
        opts: unknown
      ) => Promise<unknown>;
      return pipe;
    })();
    return pipelinePromise;
  }

  return {
    provider,
    model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const pipe = await getPipeline();
      const out: number[][] = [];
      for (const text of texts) {
        const result = await pipe(text, { pooling: "mean", normalize: false });
        out.push(coerceVector(tensorToArray(result), "transformers", expectedDim));
      }
      return out;
    },
  };
}

/** Extract a flat number[] from a transformers.js feature-extraction tensor. */
function tensorToArray(result: unknown): unknown {
  if (result && typeof result === "object" && "data" in result) {
    const data = (result as { data: unknown }).data;
    // Tensor.data is a TypedArray; spread to a plain array for validation.
    if (ArrayBuffer.isView(data)) return Array.from(data as unknown as ArrayLike<number>);
    return data;
  }
  return result;
}
