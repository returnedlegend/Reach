import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getAIServiceStatus } from "../src/lib/ai-config";

let client: typeof import("../src/lib/openrouter-client");
const routerId = "openrouter/free";
const actualId = "synthetic/vendor-free:free";
const secret = "synthetic-openrouter-key-not-for-output";
const responseSchema = z.object({ ok: z.boolean() }).strict();
const responseJsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

function configure() {
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example.org");
  vi.stubEnv("REACH_COMMUNITY_ORIGIN", "https://reach.example.org");
  vi.stubEnv("REACH_AI_PROVIDER", "openrouter");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("OPENROUTER_API_KEY", secret);
  vi.stubEnv("OPENROUTER_BASE_URL", "");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("OPENROUTER_FAST_MODEL", "");
  vi.stubEnv("OPENROUTER_PRIMARY_MODEL", "");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
  vi.stubEnv("REACH_AI_MODEL", "");
  vi.stubEnv("REACH_AI_FAST_MODEL", "");
  vi.stubEnv("REACH_AI_PRIMARY_MODEL", "");
  // Deliberately stale permissive values: the router still must stay free.
  vi.stubEnv("REACH_AI_FREE_ONLY", "false");
  vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
  vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");
  vi.stubEnv("GEMINI_MODEL", "synthetic-gemini-model");
}

function model(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    pricing: { prompt: "0", completion: "0", request: "0" },
    supported_parameters: ["tools", "structured_outputs"],
    ...patch,
  };
}

function catalog(models: unknown[]) {
  return Response.json({ data: models });
}

function completion(
  patch: Record<string, unknown> = {},
  value: unknown = { ok: true },
) {
  return Response.json({
    model: actualId,
    usage: { cost: 0 },
    choices: [{ message: { content: JSON.stringify(value) } }],
    ...patch,
  });
}

function input(
  fetcher: typeof fetch,
  patch: Partial<Parameters<typeof client.openRouterJson>[0]> = {},
) {
  return client.openRouterJson({
    role: "fast",
    feature: "guidance",
    prompt:
      "Synthetic user request; contains no real location or account data.",
    jsonSchema: responseJsonSchema,
    schema: responseSchema,
    fetch: fetcher,
    ...patch,
  });
}

async function freshClient() {
  vi.resetModules();
  client = await import("../src/lib/openrouter-client");
  configure();
}

beforeEach(async () => {
  await freshClient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("independent free OpenRouter profile verification", () => {
  it("uses the free router alone, validates its actual zero-price model, and keeps catalog requests public", async () => {
    const chatBodies: Array<Record<string, unknown>> = [];
    const catalogRequests: RequestInit[] = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/models")) {
          catalogRequests.push(init || {});
          return catalog([model(routerId), model(actualId)]);
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        chatBodies.push(body);
        return completion();
      },
    );

    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "available",
      value: { ok: true },
      model: actualId,
      calls: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(catalogRequests).toHaveLength(1);
    expect(new Headers(catalogRequests[0].headers).has("authorization")).toBe(
      false,
    );
    expect(catalogRequests[0]).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
    });
    expect(JSON.stringify(catalogRequests[0])).not.toContain(
      "Synthetic user request",
    );

    expect(chatBodies[0].model).toBe(routerId);
    expect(chatBodies[0]).not.toHaveProperty("models");
    expect(chatBodies[0].provider).toEqual({
      data_collection: "deny",
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    });
    expect(chatBodies[0].response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(
      new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization"),
    ).toBe(`Bearer ${secret}`);
  });

  it("caches only public catalog metadata for at most sixty seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    let catalogCalls = 0;
    const chatPrompts: string[] = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/models")) {
          catalogCalls += 1;
          return catalog([model(routerId), model(actualId)]);
        }
        const body = JSON.parse(String(init?.body));
        chatPrompts.push(body.messages[1].content);
        return completion();
      },
    );

    await input(fetcher as typeof fetch, { prompt: "Synthetic first prompt." });
    await input(fetcher as typeof fetch, {
      prompt: "Synthetic second prompt.",
    });
    expect(catalogCalls).toBe(1);
    expect(chatPrompts).toEqual([
      "Synthetic first prompt.",
      "Synthetic second prompt.",
    ]);

    await vi.advanceTimersByTimeAsync(60_001);
    await input(fetcher as typeof fetch, { prompt: "Synthetic third prompt." });
    expect(catalogCalls).toBe(2);
    expect(chatPrompts.at(-1)).toBe("Synthetic third prompt.");
  });

  it("rejects catalog models with paid or missing price fields, even when other prices are zero", async () => {
    const badCatalogs = [
      [
        model(routerId),
        model(actualId, {
          pricing: { prompt: "0", completion: "0", request: "0.0001" },
        }),
      ],
      [
        model(routerId),
        model(actualId, { pricing: { completion: "0", request: "0" } }),
      ],
      [
        model(routerId),
        model(actualId, { pricing: { prompt: "0", request: "0" } }),
      ],
    ];
    for (const rows of badCatalogs) {
      await freshClient();
      vi.stubEnv("OPENROUTER_FAST_MODEL", actualId);
      const fetcher = vi.fn(async () => catalog(rows));
      expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a returned router alias, unlisted model, or paid model before using output", async () => {
    const responses: Array<Record<string, unknown>> = [
      { model: null, usage: { cost: 0 } },
      { model: routerId, usage: { cost: 0 } },
      { model: "synthetic/vendor-paid", usage: { cost: 0 } },
    ];
    for (const patch of responses) {
      await freshClient();
      const fetcher = vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith("/models")
          ? catalog([
              model(routerId),
              model(actualId),
              model("synthetic/vendor-paid", {
                pricing: { prompt: "0.1", completion: "0.1" },
              }),
            ])
          : completion(patch),
      );
      const result = await input(fetcher as typeof fetch);
      expect(result).toMatchObject({ status: "unavailable", calls: 1 });
    }
  });

  it("accepts unknown nullable cost only with a concrete verified free model", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog([model(routerId), model(actualId)])
        : completion({ usage: { cost: null } }),
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "available", model: actualId });
    expect(result).not.toHaveProperty("usage.cost");
  });

  it("fails closed on positive and malformed reported costs", async () => {
    for (const cost of [0.00001, -1, "0", "not-a-cost"]) {
      await freshClient();
      const fetcher = vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith("/models")
          ? catalog([model(routerId), model(actualId)])
          : completion({ usage: { cost } }),
      );
      const result = await input(fetcher as typeof fetch);
      expect(result).toMatchObject({ status: "unavailable", calls: 1 });
    }
  });

  it("does not route a free profile through a paid fallback or Gemini when stale flags permit them", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "synthetic/vendor-paid");
    const fetcher = vi.fn(async () =>
      catalog([
        model(routerId),
        model(actualId),
        model("synthetic/vendor-paid", {
          pricing: { prompt: "0.1", completion: "0.1" },
        }),
      ]),
    );
    const rejected = await input(fetcher as typeof fetch);
    expect(rejected.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);

    await freshClient();
    const fallbackFetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog([model(routerId), model(actualId)])
        : new Response("{}", { status: 503 }),
    );
    const failed = await input(fallbackFetcher as typeof fetch);
    expect(failed.status).toBe("unavailable");
    expect(
      fallbackFetcher.mock.calls.every(([url]) =>
        String(url).startsWith("https://openrouter.ai/api/v1/"),
      ),
    ).toBe(true);
    expect(fallbackFetcher).not.toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.anything(),
    );
  });

  it("blocks unrestricted auto routing and reports configuration without inference or key disclosure", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/auto");
    const fetcher = vi.fn();
    expect((await input(fetcher as typeof fetch)).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();

    await freshClient();
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const data = getAIServiceStatus();
    expect(data).toMatchObject({ state: "configured", model: routerId });
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(globalFetch).not.toHaveBeenCalled();

    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "synthetic/vendor-paid");
    const invalidStatus = getAIServiceStatus();
    expect(invalidStatus).toMatchObject({
      state: "unavailable",
      code: "cost-policy",
    });
  });

  it("rejects response JSON that adds hallucinated fields despite valid catalog and zero cost", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog([model(routerId), model(actualId)])
        : completion({}, { ok: true, inventedEligibility: "confirmed" }),
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "unavailable", calls: 1 });
  });

  it("rejects malformed completion JSON without exposing the provider body", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog([model(routerId), model(actualId)])
        : Response.json({
            model: actualId,
            usage: { cost: 0 },
            choices: [{ message: { content: "not-json; synthetic secret" } }],
          }),
    );
    const result = await input(fetcher as typeof fetch);
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "OpenRouter returned an invalid response.",
      calls: 1,
    });
    expect(JSON.stringify(result)).not.toContain("synthetic secret");
  });
});
