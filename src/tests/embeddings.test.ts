import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { SearchConfig } from "../config.js";
import { createEmbedder } from "../search/embeddings.js";

function cfg(over: Partial<SearchConfig>): SearchConfig {
  return {
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    embeddingDimensions: null,
    embeddingEndpoint: "",
    embeddingApiKeyEnv: "",
    ...over,
  };
}

interface FakeCall {
  url: string;
  init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
let calls: FakeCall[] = [];

function stubFetch(handler: (url: string, init: RequestInit | undefined) => unknown): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    const b = body as { status?: number; statusText?: string; json?: unknown; text?: string };
    const status = b.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: b.statusText ?? "OK",
      json: async () => {
        if (b.json instanceof Error) throw b.json;
        return b.json;
      },
      text: async () => b.text ?? "",
    };
  }) as typeof fetch;
}

describe("createEmbedder", () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.VT_TEST_KEY;
  });

  it("ollama: posts to /api/embed and parses { embeddings }", async () => {
    stubFetch((url, init) => {
      assert.ok(url.endsWith("/api/embed"), `unexpected url ${url}`);
      const parsed = JSON.parse(String(init?.body));
      assert.equal(parsed.model, "nomic-embed-text");
      assert.deepEqual(parsed.input, ["hello"]);
      return { json: { embeddings: [[0.1, 0.2, 0.3]] } };
    });
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    const out = await emb.embed(["hello"]);
    assert.deepEqual(out, [[0.1, 0.2, 0.3]]);
    assert.ok(
      calls[0].url.startsWith("http://localhost:11434"),
      "uses the ollama default endpoint"
    );
  });

  it("openai-shape: posts to /v1/embeddings and parses { data[].embedding }", async () => {
    stubFetch((url) => {
      assert.ok(url.endsWith("/v1/embeddings"), `unexpected url ${url}`);
      return { json: { data: [{ embedding: [1, 2], index: 0 }] } };
    });
    const emb = createEmbedder(cfg({ embeddingProvider: "lmstudio" }));
    const out = await emb.embed(["hi"]);
    assert.deepEqual(out, [[1, 2]]);
  });

  it("openai-shape: reorders results by the response index field", async () => {
    stubFetch(() => ({
      json: {
        data: [
          { embedding: [9, 9], index: 1 },
          { embedding: [1, 1], index: 0 },
        ],
      },
    }));
    const emb = createEmbedder(
      cfg({ embeddingProvider: "openai-compatible", embeddingEndpoint: "http://x" })
    );
    const out = await emb.embed(["a", "b"]);
    assert.deepEqual(out, [
      [1, 1],
      [9, 9],
    ]);
  });

  it("chunks large inputs into batches", async () => {
    stubFetch((_url, init) => {
      const parsed = JSON.parse(String(init?.body));
      const n = parsed.input.length;
      return { json: { embeddings: Array.from({ length: n }, () => [1, 0]) } };
    });
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    const texts = Array.from({ length: 130 }, (_, i) => `t${i}`);
    const out = await emb.embed(texts);
    assert.equal(out.length, 130);
    assert.equal(calls.length, 3, "130 inputs at batch size 64 → 3 requests");
  });

  it("throws an actionable error when the server is unreachable", async () => {
    stubFetch(() => new Error("ECONNREFUSED"));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /Ollama not reachable/);
  });

  it("surfaces an actionable timeout error when the request aborts", async () => {
    // fetch() rejects with an AbortError-named error when the signal fires;
    // simulate that directly so the assertion stays deterministic (no 30s wait).
    stubFetch(() => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      return err;
    });
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /timed out after 30s/);
  });

  it("throws on a non-2xx response, surfacing the status", async () => {
    stubFetch(() => ({ status: 500, statusText: "Internal Server Error", text: "boom" }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /HTTP 500/);
  });

  it("throws on a malformed ollama response missing 'embeddings'", async () => {
    stubFetch(() => ({ json: { not_embeddings: true } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /missing 'embeddings'/);
  });

  it("throws on a non-finite value in the returned vector", async () => {
    stubFetch(() => ({ json: { embeddings: [["not a number"]] } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /non-finite/);
  });

  // The string case above trips the `typeof` guard before Number.isFinite;
  // these two exercise the numeric branch (Infinity/NaN are `typeof "number"`).
  it("throws on Infinity in the returned vector", async () => {
    stubFetch(() => ({ json: { embeddings: [[1, Infinity, 3]] } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /non-finite/);
  });

  it("throws on NaN in the returned vector", async () => {
    stubFetch(() => ({ json: { embeddings: [[NaN]] } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    await assert.rejects(() => emb.embed(["x"]), /non-finite/);
  });

  it("returns an empty array for empty input without making a request", async () => {
    stubFetch(() => ({ json: { embeddings: [] } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama" }));
    const out = await emb.embed([]);
    assert.deepEqual(out, []);
    assert.equal(calls.length, 0, "should not POST for empty input");
  });

  it("enforces embedding_dimensions when configured", async () => {
    stubFetch(() => ({ json: { embeddings: [[1, 2, 3]] } }));
    const emb = createEmbedder(cfg({ embeddingProvider: "ollama", embeddingDimensions: 768 }));
    await assert.rejects(() => emb.embed(["x"]), /dimension mismatch/);
  });

  it("cloud provider without an api key env name throws at construction", () => {
    assert.throws(() => createEmbedder(cfg({ embeddingProvider: "openai" })), /needs an API key/);
  });

  it("cloud provider with an unset api key env var throws at construction", () => {
    assert.throws(
      () => createEmbedder(cfg({ embeddingProvider: "openai", embeddingApiKeyEnv: "VT_TEST_KEY" })),
      /VT_TEST_KEY is empty or unset/
    );
  });

  it("cloud provider sends a Bearer token when the key is present", async () => {
    process.env.VT_TEST_KEY = "sk-secret";
    stubFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["authorization"], "Bearer sk-secret");
      return { json: { data: [{ embedding: [1], index: 0 }] } };
    });
    const emb = createEmbedder(
      cfg({ embeddingProvider: "openai", embeddingApiKeyEnv: "VT_TEST_KEY" })
    );
    await emb.embed(["x"]);
  });

  it("openai-compatible without an endpoint throws an actionable error", () => {
    assert.throws(
      () => createEmbedder(cfg({ embeddingProvider: "openai-compatible" })),
      /no endpoint/
    );
  });

  it("transformers: constructs without throwing and defers the model load", () => {
    // The pipeline (and the optional dependency import) load lazily on first
    // embed(), so construction must not require the package to be present.
    const emb = createEmbedder(
      cfg({ embeddingProvider: "transformers", embeddingModel: "some/model" })
    );
    assert.equal(emb.provider, "transformers");
    assert.equal(emb.model, "some/model");
  });
});
