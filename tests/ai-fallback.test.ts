import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let accessAI: typeof import("../src/lib/access-ai");
beforeEach(async () => {
  vi.resetModules();
  accessAI = await import("../src/lib/access-ai");
  vi.stubEnv("REACH_AI_PROVIDER", "openrouter");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("REACH_AI_FREE_ONLY", "false");
  vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-openrouter-key");
  vi.stubEnv("OPENROUTER_FAST_MODEL", "fixture/model");
  vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
  vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
  vi.stubEnv("REACH_AI_GEMINI_FALLBACK", "true");
});
afterEach(() => vi.unstubAllEnvs());

const jsonResponse = (
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
) => new Response(JSON.stringify(value), { status, headers });
const catalog = () =>
  jsonResponse({
    data: [
      {
        id: "fixture/model",
        pricing: { prompt: "0.1", completion: "0.2" },
        supported_parameters: ["tools", "structured_outputs"],
      },
    ],
  });
const preferenceOutput = (mode: string | null = "driving") => ({
  maxWalkingMinutes: null,
  maxWalkingMiles: null,
  fareBudget: null,
  mode,
  maxTransfers: null,
  visitMinutes: null,
  mobility: null,
  allowWaiting: null,
  dietaryPreference: null,
  dietaryRequired: null,
});
const openRouterTransient = () => jsonResponse({}, 503);
const geminiOutput = (output: unknown) =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
  });

describe("explicit Gemini fallback", () => {
  it("uses one Gemini attempt after a transient OpenRouter failure with keys only in headers", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const stringUrl = String(url);
        seen.push({ url: stringUrl, init });
        if (stringUrl.endsWith("/models")) return catalog();
        if (stringUrl.includes("openrouter.ai")) return openRouterTransient();
        return geminiOutput(preferenceOutput());
      },
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.patch).toEqual({ mode: "driving" });
    const gemini = seen.find((entry) =>
      entry.url.includes("generativelanguage.googleapis.com"),
    )!;
    expect(gemini.url).not.toContain("fixture-gemini-key");
    expect(new Headers(gemini.init?.headers).get("x-goog-api-key")).toBe(
      "fixture-gemini-key",
    );
    expect(seen.filter((entry) => entry.init?.method === "POST")).toHaveLength(
      2,
    );
    const body = JSON.parse(String(gemini.init?.body));
    expect(body.generationConfig.responseFormat.text.mimeType).toBe(
      "APPLICATION_JSON",
    );
    expect(body.generationConfig.responseFormat.text.schema).toBeDefined();
  });

  it("does not transfer malformed output or a long Retry-After to Gemini", async () => {
    for (const failure of [
      jsonResponse({ choices: [{ message: { content: "not-json" } }] }),
      jsonResponse({}, 429, { "retry-after": "5" }),
    ]) {
      vi.resetModules();
      accessAI = await import("../src/lib/access-ai");
      const fetcher = vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith("/models")
          ? catalog()
          : String(url).includes("openrouter.ai")
            ? failure
            : geminiOutput(preferenceOutput()),
      );
      const result = await accessAI.interpretPreferences("I prefer driving", {
        fetch: fetcher as typeof fetch,
      });
      expect(result.status).toBe("unavailable");
      expect(
        fetcher.mock.calls.some(([url]) =>
          String(url).includes("generativelanguage.googleapis.com"),
        ),
      ).toBe(false);
    }
  });

  it("requires every explicit privacy and paid-use switch before a Gemini-only request", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "false");
    const fetcher = vi.fn(async (_url: RequestInfo | URL) =>
      geminiOutput(preferenceOutput()),
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not bypass the default free profile when OpenRouter is absent", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "");
    const fetcher = vi.fn(async (_url: RequestInfo | URL) =>
      geminiOutput(preferenceOutput()),
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps an explicit disabled provider from activating Gemini fallback", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "disabled");
    const fetcher = vi.fn(async (_url: RequestInfo | URL) =>
      geminiOutput(preferenceOutput()),
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows an explicitly configured Gemini-only provider through the existing native path", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "gemini");
    vi.stubEnv("REACH_AI_MODEL", "");
    const fetcher = vi.fn(async () =>
      geminiOutput(preferenceOutput("walking")),
    );
    const result = await accessAI.interpretPreferences("I prefer walking", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.patch).toEqual({ mode: "walking" });
  });
});
