import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
let client: typeof import("../src/lib/deepseek-client");
let config: typeof import("../src/lib/ai-config");
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("REACH_AI_PROVIDER", "groq");
  vi.stubEnv("REACH_RELEASE_AI", "true");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
  vi.stubEnv("GROQ_MODEL", "");
  vi.stubEnv("GROQ_TIMEOUT_MS", "");
  client = await import("../src/lib/deepseek-client");
  config = await import("../src/lib/ai-config");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const run = (fetcher: typeof fetch) =>
  client.deepseekJson({
    role: "primary",
    feature: "ranking",
    maxAttempts: 1,
    nativeSchema: true,
    prompt: "Compare synthetic pantry facts. Return JSON.",
    schema: z.object({ ok: z.boolean() }).strict(),
    jsonSchema: { type: "object" },
    fetch: fetcher,
  });
it("defaults to Groq and ignores legacy Ollama model settings", () => {
  vi.stubEnv("REACH_AI_PROVIDER", "");
  vi.stubEnv("OLLAMA_MODEL", "llama3.2:3b");
  expect(config.getAIServiceStatus()).toMatchObject({
    state: "configured",
    model: "openai/gpt-oss-20b",
  });
});
it("uses only official Groq with supported JSON mode and bounded output", async () => {
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer synthetic-groq-key",
    );
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "openai/gpt-oss-20b",
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      max_tokens: 2048,
    });
    expect(body.thinking).toBeUndefined();
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    });
  });
  expect(await run(fetcher)).toMatchObject({
    status: "available",
    value: { ok: true },
  });
});
it.each(["", "your_groq_api_key_here"])(
  "does not call Groq with a missing/placeholder credential",
  async (key) => {
    vi.stubEnv("GROQ_API_KEY", key);
    const fetcher = vi.fn();
    expect(await run(fetcher)).toMatchObject({
      status: "unavailable",
      calls: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("requires hosted data policy consent before sending", async () => {
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "false");
  const fetcher = vi.fn();
  expect(await run(fetcher)).toMatchObject({ status: "unavailable", calls: 0 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 429, 500])(
  "reports Groq HTTP %i safely with no provider fallback",
  async (status) => {
    const fetcher = vi.fn(
      async () => new Response("private provider details", { status }),
    );
    const result = await run(fetcher);
    expect(result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("Groq"),
    });
    expect(JSON.stringify(result)).not.toContain("private provider details");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it("rejects invalid model output", async () => {
  expect(
    await run(
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"invented":true}' } }],
        }),
      ),
    ),
  ).toMatchObject({ status: "unavailable" });
});
it("ends a stalled request at the hosted deadline", async () => {
  vi.useFakeTimers();
  const result = run(
    vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ),
  );
  await vi.advanceTimersByTimeAsync(20000);
  expect(await result).toMatchObject({
    status: "unavailable",
    reason: "Groq request timed out.",
  });
});

it("enables configured Groq in the production anonymous core", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REACH_RELEASE_PROFILE", "core");
  const { publicFeatures } = await import("../src/lib/release-features");
  expect(config.getAIServiceStatus().state).toBe("configured");
  expect(publicFeatures()).toMatchObject({ ai: true, accounts: false });
});
