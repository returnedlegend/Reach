import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { deepseekJson } from "../src/lib/deepseek-client";
import { getAIServiceStatus } from "../src/lib/ai-config";
import { interpretPreferences } from "../src/lib/access-ai";
beforeEach(() => {
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("OLLAMA_BASE_URL", "");
  vi.stubEnv("OLLAMA_MODEL", "llama3.2:3b");
});
afterEach(() => vi.unstubAllEnvs());
it("uses local Llama without sending cloud credentials or thinking parameters", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("llama3.2:3b");
    expect(body.thinking).toBeUndefined();
    return Response.json({
      choices: [{ message: { content: '{"ok":true}' } }],
    });
  });
  expect(
    (
      await deepseekJson({
        role: "primary",
        feature: "guidance",
        prompt: "Synthetic",
        schema: z.object({ ok: z.boolean() }).strict(),
        jsonSchema: { type: "object" },
        fetch: fetcher,
      })
    ).status,
  ).toBe("available");
});
it("rejects remote endpoints before sending any text", () => {
  vi.stubEnv("OLLAMA_BASE_URL", "https://example.com/v1");
  expect(getAIServiceStatus().state).toBe("unavailable");
});
it("preserves preference validation through the actual workflow", async () => {
  const result = await interpretPreferences("I prefer transit", {
    fetch: vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: '{"mode":"transit"}' } }],
      }),
    ),
  });
  expect(result).toMatchObject({
    status: "available",
    patch: { mode: "transit" },
  });
});
it("reports unavailable when local Ollama is stopped", async () => {
  const result = await deepseekJson({
    role: "fast",
    feature: "needs",
    prompt: "Synthetic",
    schema: z.object({ ok: z.boolean() }),
    jsonSchema: { type: "object" },
    fetch: vi.fn(async () => {
      throw Error("connection refused");
    }),
  });
  expect(result).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("Local Llama"),
  });
});

it("defaults to Llama even if an old DeepSeek key is present", () => {
  vi.stubEnv("REACH_AI_PROVIDER", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-old-key");
  expect(getAIServiceStatus()).toMatchObject({
    state: "configured",
    model: "llama3.2:3b",
  });
});
it("accepts only the named private Compose service in addition to loopback", () => {
  vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434/v1");
  expect(getAIServiceStatus().state).toBe("configured");
});
