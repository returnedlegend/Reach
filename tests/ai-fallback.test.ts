import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let accessAI: typeof import("../src/lib/access-ai");
beforeEach(async () => {
  vi.resetModules();
  accessAI = await import("../src/lib/access-ai");
  vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-deepseek-key");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
  vi.stubEnv("GEMINI_API_KEY", "fixture-gemini-key");
  vi.stubEnv("GEMINI_MODEL", "fixture-gemini-model");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
});
afterEach(() => vi.unstubAllEnvs());

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
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
const deepSeekOutput = (output: unknown) =>
  jsonResponse({ choices: [{ message: { content: JSON.stringify(output) } }] });
const geminiOutput = (output: unknown) =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
  });

describe("explicit provider selection", () => {
  it("uses one DeepSeek attempt and never falls back to Gemini", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        deepSeekOutput(preferenceOutput()),
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("available");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });

  it("keeps malformed DeepSeek output unavailable without trying another provider", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ choices: [{ message: { content: "not-json" } }] }),
    );
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("api.deepseek.com");
  });

  it("requires explicit privacy acceptance before a DeepSeek request", async () => {
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "false");
    const fetcher = vi.fn(async () => deepSeekOutput(preferenceOutput()));
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not route missing DeepSeek credentials to Gemini implicitly", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const fetcher = vi.fn(async () => geminiOutput(preferenceOutput()));
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps an explicit disabled provider from activating another provider", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "disabled");
    const fetcher = vi.fn(async () => geminiOutput(preferenceOutput()));
    const result = await accessAI.interpretPreferences("I prefer driving", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows an explicitly configured Gemini-only provider through its native path", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "gemini");
    vi.stubEnv("REACH_AI_MODEL", "");
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        geminiOutput(preferenceOutput("walking")),
    );
    const result = await accessAI.interpretPreferences("I prefer walking", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.patch).toEqual({ mode: "walking" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });
});
