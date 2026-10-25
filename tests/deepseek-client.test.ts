import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
let client: typeof import("../src/lib/deepseek-client");
const schema = z.object({ ok: z.boolean() }).strict();
const jsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const completion = (value: unknown = { ok: true }, patch: object = {}) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
    ...patch,
  });
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
  vi.stubEnv("REACH_RELEASE_AI", "true");
  vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-key-not-real");
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
  vi.stubEnv("DEEPSEEK_MODEL", "");
  vi.stubEnv("DEEPSEEK_REASONING_MODEL", "");
  vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "");
  client = await import("../src/lib/deepseek-client");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const run = (
  fetcher: typeof fetch,
  patch: Partial<Parameters<typeof client.deepseekJson>[0]> = {},
) =>
  client.deepseekJson({
    role: "fast",
    feature: "needs",
    prompt: "Find groceries; synthetic test",
    jsonSchema,
    schema,
    fetch: fetcher,
    ...patch,
  });
describe("direct DeepSeek client", () => {
  it("uses authenticated official JSON mode, no routing headers/catalog, and bounded non-thinking output", async () => {
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(url).toBe("https://api.deepseek.com/chat/completions");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer synthetic-key-not-real",
        );
        expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          model: "deepseek-flash",
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          max_tokens: 1600,
          stream: false,
        });
        expect(body).not.toHaveProperty("provider");
        expect(body).not.toHaveProperty("models");
        expect(body.messages[0].content).toContain(JSON.stringify(jsonSchema));
        return completion();
      },
    );
    expect(await run(fetcher as typeof fetch)).toMatchObject({
      status: "available",
      value: { ok: true },
      model: "deepseek-flash",
      calls: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the separate configured reasoning model only for primary requests", async () => {
    vi.stubEnv("DEEPSEEK_REASONING_MODEL", "deepseek-v4-pro");
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: "deepseek-v4-pro",
          thinking: { type: "enabled" },
          reasoning_effort: "low",
          max_tokens: 4096,
        });
        return completion();
      },
    );
    expect(
      (await run(fetcher as typeof fetch, { role: "primary" })).status,
    ).toBe("available");
  });
  it("supports the official v1 alias and environment model selection", async () => {
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1/");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
      return completion();
    });
    expect((await run(fetcher as typeof fetch)).status).toBe("available");
  });
  it.each([401, 402, 403, 404, 422])(
    "does not retry HTTP %s or return the provider error body",
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response("sensitive-provider-detail", { status }),
      );
      const result = await run(fetcher as typeof fetch);
      expect(result).toMatchObject({ status: "unavailable", calls: 1 });
      expect(JSON.stringify(result)).not.toContain("sensitive-provider-detail");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([429, 500, 503])(
    "retries HTTP %s once on the same model",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status }))
        .mockImplementationOnce(async () => completion());
      expect(await run(fetcher as typeof fetch)).toMatchObject({
        status: "available",
        calls: 2,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("respects long Retry-After without a premature retry", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "120" } }),
    );
    expect((await run(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not duplicate an ambiguously billed network failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("synthetic secret response");
    });
    const result = await run(fetcher as typeof fetch);
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("secret response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { choices: [{ message: { content: "" } }] },
    { choices: [{ message: { content: "not json" } }] },
    { choices: [{ message: { content: '{"ok":"yes"}' } }] },
    {
      choices: [{ message: { content: '{"ok":true,"newPantry":"invented"}' } }],
    },
    {
      choices: [
        { finish_reason: "length", message: { content: '{"ok":true}' } },
      ],
    },
    {
      choices: [
        { finish_reason: "tool_calls", message: { content: '{"ok":true}' } },
      ],
    },
  ])("rejects malformed, invented or incomplete content %j", async (body) => {
    const fetcher = vi.fn(async () => Response.json(body));
    expect((await run(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized responses with and without content-length", async () => {
    for (const headers of [
      { "content-length": "999999" },
      {},
    ] as HeadersInit[]) {
      const fetcher = vi.fn(
        async () => new Response(" ".repeat(140000), { headers }),
      );
      expect((await run(fetcher as typeof fetch)).status).toBe("unavailable");
    }
  });
  it("does not transfer prompts to an alternate provider when DeepSeek fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "synthetic-other-key");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toMatch(/^https:\/\/api\.deepseek\.com\//);
      return new Response("", { status: 503 });
    });
    expect((await run(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("counts actual attempts and provided usage without estimating dollar cost", async () => {
    const fetcher = vi.fn(async () =>
      completion(
        { ok: true },
        {
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        },
      ),
    );
    expect(await run(fetcher as typeof fetch)).toMatchObject({
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
    expect(client.getDeepSeekUsageSnapshot()).toMatchObject({
      attempts: 1,
      successes: 1,
      failures: 0,
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });
    expect(client.getDeepSeekUsageSnapshot()).not.toHaveProperty("cost");
  });
  it("charges retries against the feature request allowance", async () => {
    vi.stubEnv("REACH_AI_NEEDS_MINUTE_LIMIT", "1");
    const fetcher = vi.fn(async () => new Response("", { status: 503 }));
    expect(await run(fetcher as typeof fetch)).toMatchObject({
      status: "unavailable",
      calls: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["-1", "1.2", "10000", "invalid"])(
    "fails closed for malformed quota %s",
    async (value) => {
      vi.stubEnv("REACH_AI_NEEDS_DAILY_LIMIT", value);
      const fetcher = vi.fn();
      expect((await run(fetcher as typeof fetch)).status).toBe("unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

it("uses Ollama native JSON schema constraints for pantry comparisons", async () => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "reach_response", strict: true, schema: jsonSchema },
    });
    return completion();
  });
  expect(await run(fetcher, { nativeSchema: true })).toMatchObject({
    status: "available",
  });
});

it("lets a slow local pantry comparison finish after the former 40-second deadline", async () => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).max_tokens).toBe(256);
    await new Promise<void>((resolve, reject) => {
      setTimeout(resolve, 50_000);
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
    return completion();
  });
  const pending = run(fetcher, { feature: "ranking" });
  await vi.advanceTimersByTimeAsync(50_000);
  expect(await pending).toMatchObject({ status: "available" });
});
it("ends a stalled local comparison at two minutes with actionable guidance", async () => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  vi.useFakeTimers();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const pending = run(fetcher, { feature: "ranking" });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await pending).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("Keep Ollama running"),
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("keeps cloud comparison timeouts short", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const pending = run(fetcher, { feature: "ranking" });
  await vi.advanceTimersByTimeAsync(12_000);
  expect(await pending).toMatchObject({
    status: "unavailable",
    reason: "DeepSeek request timed out.",
  });
});
it("distinguishes user cancellation from model timeout", async () => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  const controller = new AbortController();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
        controller.abort();
      }),
  );
  expect(
    await run(fetcher, { feature: "ranking", signal: controller.signal }),
  ).toMatchObject({
    status: "unavailable",
    reason: "Local Llama 3.2 request was cancelled.",
  });
});
it("keeps the browser deadline beyond local inference", async () => {
  const { FOOD_SEARCH_TIMEOUT_MS, LOCAL_RANKING_TIMEOUT_MS } = await import(
    "../src/lib/ai-timing"
  );
  expect(FOOD_SEARCH_TIMEOUT_MS).toBeGreaterThan(LOCAL_RANKING_TIMEOUT_MS);
});

it("reports a deadline while reading a stalled response body", async () => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  vi.useFakeTimers();
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"choices":'));
          },
        }),
      ),
  );
  const pending = run(fetcher, { feature: "ranking" });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(await pending).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("Keep Ollama running"),
  });
});
