import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

let client: typeof import("../src/lib/openrouter-client");
beforeEach(async () => {
  vi.resetModules();
  client = await import("../src/lib/openrouter-client");
});
afterEach(() => vi.unstubAllEnvs());

const outputSchema = z.object({ ok: z.boolean() }).strict();
const outputJsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
function configure() {
  vi.stubEnv("REACH_AI_PROVIDER", "openrouter");
  vi.stubEnv("REACH_AI_MODEL", "fixture/model:free");
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("REACH_AI_FREE_ONLY", "true");
}
function model(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    pricing: { prompt: "0", completion: "0", request: "0" },
    supported_parameters: ["tools", "structured_outputs"],
    ...patch,
  };
}
function catalog(models = [model("fixture/model:free")]) {
  return new Response(JSON.stringify({ data: models }), { status: 200 });
}
function completion(value: unknown, status = 200, headers: HeadersInit = {}) {
  const responseBody =
    status >= 200 && status < 300
      ? { choices: [{ message: { content: JSON.stringify(value) } }] }
      : {};
  return new Response(JSON.stringify(responseBody), { status, headers });
}
function input(
  fetcher: typeof fetch,
  patch: Partial<Parameters<typeof client.openRouterJson>[0]> = {},
) {
  return client.openRouterJson({
    role: "fast",
    feature: "preferences",
    prompt: "untrusted fixture",
    jsonSchema: outputJsonSchema,
    schema: outputSchema,
    fetch: fetcher,
    ...patch,
  });
}

describe("shared OpenRouter client", () => {
  it("fails closed before HTTP when credentials, provider, or privacy acceptance are missing", async () => {
    const fetcher = vi.fn();
    configure();
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "false");
    expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks public catalog capabilities and disables router fallbacks", async () => {
    configure();
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/models")) {
          expect(new Headers(init?.headers).has("authorization")).toBe(false);
          return catalog();
        }
        const body = JSON.parse(String(init?.body));
        expect(body.provider).toEqual({
          data_collection: "deny",
          allow_fallbacks: false,
          require_parameters: true,
          max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
        });
        expect(Array.isArray(body.models)).toBe(false);
        return completion({ ok: true });
      },
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "available",
      value: { ok: true },
      model: "fixture/model:free",
      calls: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires tools and structured output support for every configured model", async () => {
    configure();
    vi.stubEnv("REACH_AI_FAST_MODEL", "fast/model:free");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "backup/model:free");
    const fetcher = vi.fn(async () =>
      catalog([
        model("fast/model:free"),
        model("backup/model:free", { supported_parameters: ["tools"] }),
      ]),
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "unavailable", calls: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses role-specific models and falls back only to the explicitly configured model on transient failure", async () => {
    configure();
    vi.stubEnv("REACH_AI_MODEL", "legacy/model:free");
    vi.stubEnv("OPENROUTER_PRIMARY_MODEL", "primary/model:free");
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "backup/model:free");
    const tried: string[] = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/models"))
          return catalog([
            model("primary/model:free"),
            model("backup/model:free"),
          ]);
        const request = JSON.parse(String(init?.body));
        tried.push(request.model);
        return request.model === "primary/model:free"
          ? completion(null, 503)
          : completion({ ok: true });
      },
    );
    const result = await input(fetcher as typeof fetch, {
      role: "primary",
      feature: "guidance",
    });
    expect(tried).toEqual(["primary/model:free", "backup/model:free"]);
    expect(result).toMatchObject({
      status: "available",
      model: "backup/model:free",
      calls: 2,
    });
  });

  it("uses the canonical fast model when the legacy model is absent", async () => {
    configure();
    vi.stubEnv("REACH_AI_MODEL", "");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "fast/model:free");
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/models"))
          return catalog([model("fast/model:free")]);
        expect(JSON.parse(String(init?.body)).model).toBe("fast/model:free");
        return completion({ ok: true });
      },
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "available",
      model: "fast/model:free",
    });
  });

  it("supports OPENROUTER_MODEL and an implicit configured provider, while rejecting custom base hosts", async () => {
    configure();
    vi.stubEnv("REACH_AI_PROVIDER", "");
    vi.stubEnv("REACH_AI_MODEL", "");
    vi.stubEnv("OPENROUTER_MODEL", "fixture/model:free");
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models") ? catalog() : completion({ ok: true }),
    );
    expect((await input(fetcher as typeof fetch)).status).toBe("available");

    vi.resetModules();
    client = await import("../src/lib/openrouter-client");
    configure();
    vi.stubEnv("OPENROUTER_BASE_URL", "https://example.invalid/api/v1");
    const blockedFetcher = vi.fn();
    expect((await input(blockedFetcher as typeof fetch)).status).toBe(
      "unavailable",
    );
    expect(blockedFetcher).not.toHaveBeenCalled();
  });

  it("lets an explicit disabled provider override otherwise valid OpenRouter settings", async () => {
    configure();
    vi.stubEnv("REACH_AI_PROVIDER", "disabled");
    const fetcher = vi.fn();
    expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shares transient OpenRouter fallback with direct navigation callers", async () => {
    configure();
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
    vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
    vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
    vi.stubEnv("OPENROUTER_MODEL", "fixture/model");
    vi.stubEnv("REACH_AI_MODEL", "");
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const address = String(url);
        if (address.endsWith("/models"))
          return catalog([
            model("fixture/model", {
              pricing: { prompt: "0.1", completion: "0.2" },
            }),
          ]);
        if (address.includes("openrouter.ai")) return completion(null, 503);
        expect(address).not.toContain("fixture-gemini-key");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
          "fixture-gemini-key",
        );
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ ok: true }) }] } },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "available",
      value: { ok: true },
      model: "fixture-gemini-model",
      calls: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not bypass the default free profile with Gemini-only fallback controls", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "");
    vi.stubEnv("OPENROUTER_MODEL", "");
    vi.stubEnv("REACH_AI_MODEL", "");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
    vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
    vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ ok: true }) }] } },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "unavailable", calls: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back after catalog network/5xx failures but not after an invalid catalog", async () => {
    configure();
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
    vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
    vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
    vi.stubEnv("OPENROUTER_MODEL", "fixture/model");
    vi.stubEnv("REACH_AI_MODEL", "");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const address = String(url);
      if (address.endsWith("/models"))
        return new Response("{}", { status: 503 });
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ ok: true }) }] } },
          ],
        }),
        { status: 200 },
      );
    });
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "available",
      model: "fixture-gemini-model",
      calls: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/chat/completions"),
      ),
    ).toBe(false);

    vi.resetModules();
    client = await import("../src/lib/openrouter-client");
    configure();
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
    vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
    vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
    vi.stubEnv("OPENROUTER_MODEL", "fixture/model");
    vi.stubEnv("REACH_AI_MODEL", "");
    const invalidCatalogFetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? new Response(JSON.stringify({ data: "invalid" }), { status: 200 })
        : new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: JSON.stringify({ ok: true }) }] },
                },
              ],
            }),
            { status: 200 },
          ),
    );
    expect((await input(invalidCatalogFetcher as typeof fetch)).status).toBe(
      "unavailable",
    );
    expect(invalidCatalogFetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after authentication, malformed output, or schema failure", async () => {
    configure();
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "backup/model:free");
    const allModels = [model("fixture/model:free"), model("backup/model:free")];
    for (const resultResponse of [
      completion(null, 401),
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not-json" } }] }),
        { status: 200 },
      ),
      completion({ ok: "yes" }),
    ]) {
      const fetcher = vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith("/models") ? catalog(allModels) : resultResponse,
      );
      const result = await input(fetcher as typeof fetch);
      expect(result).toMatchObject({ status: "unavailable", calls: 1 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it("does not retry a long Retry-After and retries a short one once", async () => {
    configure();
    let calls = 0;
    const longFetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/models")) return catalog();
      calls += 1;
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "5" },
      });
    });
    expect((await input(longFetcher as typeof fetch)).status).toBe(
      "unavailable",
    );
    expect(calls).toBe(1);

    vi.resetModules();
    client = await import("../src/lib/openrouter-client");
    configure();
    calls = 0;
    const shortFetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/models")) return catalog();
      calls += 1;
      return calls === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "0.1" } })
        : completion({ ok: true });
    });
    expect((await input(shortFetcher as typeof fetch)).status).toBe(
      "available",
    );
    expect(calls).toBe(2);
  });

  it("requires explicit dual opt-in for paid models", async () => {
    configure();
    vi.stubEnv("REACH_AI_MODEL", "fixture/model");
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    const fetcher = vi.fn(async () =>
      catalog([
        model("fixture/model", { pricing: { prompt: "1", completion: "2" } }),
      ]),
    );
    expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();

    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.resetModules();
    client = await import("../src/lib/openrouter-client");
    vi.stubEnv("REACH_AI_MODEL", "fixture/model");
    const allowedFetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog([
            model("fixture/model", {
              pricing: { prompt: "1", completion: "2" },
            }),
          ])
        : completion({ ok: true }),
    );
    expect((await input(allowedFetcher as typeof fetch)).status).toBe(
      "available",
    );
  });

  it("enforces feature quotas and fails closed on invalid settings", async () => {
    configure();
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models") ? catalog() : completion({ ok: true }),
    );
    for (let index = 0; index < 5; index += 1)
      expect((await input(fetcher as typeof fetch)).status).toBe("available");
    expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(1);

    vi.resetModules();
    client = await import("../src/lib/openrouter-client");
    configure();
    vi.stubEnv("REACH_AI_NEEDS_DAILY_LIMIT", "999999");
    const invalidConfigFetcher = vi.fn();
    expect(
      (await input(invalidConfigFetcher as typeof fetch, { feature: "needs" }))
        .status,
    ).toBe("unavailable");
    expect(invalidConfigFetcher).not.toHaveBeenCalled();
  });
});
