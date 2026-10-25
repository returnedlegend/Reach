import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let agent: typeof import("../src/lib/navigation-needs-agent");

beforeEach(async () => {
  // This suite opts into each provider explicitly; inherited cloud keys must
  // not activate DeepSeek in the deterministic-only fixture below.
  vi.stubEnv("REACH_AI_PROVIDER", "disabled");
  vi.resetModules();
  agent = await import("../src/lib/navigation-needs-agent");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function useDeepSeek() {
  vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
  vi.stubEnv("DEEPSEEK_API_KEY", "secret-test-key");
  vi.stubEnv("REACH_AI_FREE_ONLY", "true");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function modelOutput(
  patch: Record<string, unknown> = {},
  needs: Record<string, unknown> = {},
) {
  return {
    patch: {
      maxWalkingMinutes: null,
      maxWalkingMiles: null,
      fareBudget: null,
      mode: null,
      maxTransfers: null,
      visitMinutes: null,
      mobility: null,
      allowWaiting: null,
      dietaryPreference: null,
      dietaryRequired: null,
      ...patch,
    },
    needs: {
      service: null,
      urgency: null,
      householdSize: null,
      hasIdentification: null,
      preferTransitNearby: null,
      ...needs,
    },
  };
}

function completion(value: unknown) {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(value) } }],
  });
}

describe("navigation needs interpreter", () => {
  it("uses one strict DeepSeek structured response and removes nullable leaves", async () => {
    useDeepSeek();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        completion(
          modelOutput(
            { mode: "driving", maxWalkingMinutes: 15 },
            {
              service: "groceries",
              urgency: "today",
              householdSize: 3,
              hasIdentification: "yes",
              preferTransitNearby: true,
            },
          ),
        ),
    );

    const result = await agent.interpretNavigationNeeds(
      "I need groceries today for a household of 3. I have ID and prefer somewhere near public transit. I can drive and walk 15 minutes.",
      { fetch: fetcher as typeof fetch },
    );

    expect(result).toMatchObject({
      status: "available",
      patch: { mode: "driving", maxWalkingMinutes: 15 },
      needs: {
        service: "groceries",
        urgency: "today",
        householdSize: 3,
        hasIdentification: "yes",
        preferTransitNearby: true,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.model).toBe("deepseek-flash");
    const schemaPrompt = request.messages[0].content;
    expect(schemaPrompt).toContain("additionalProperties");
    const schema = JSON.parse(
      schemaPrompt.split("JSON schema: ")[1].split(". Example of")[0],
    );
    expect(schema.required).toEqual(["patch", "needs"]);
    expect(schema.properties.patch.required).toContain("mode");
    expect(schema.properties.patch.properties).not.toHaveProperty("origin");
    expect(schema.properties.patch.properties).not.toHaveProperty("date");
    expect(schema.properties.patch.properties).not.toHaveProperty(
      "eligibilityConfirmed",
    );
    expect(schema.properties.patch.properties).not.toHaveProperty(
      "appointment",
    );
    expect(request.messages[1].content).toContain("untrusted text");
  });

  it("does not send descriptions with location, email, or phone details", async () => {
    useDeepSeek();
    const fetcher = vi.fn();
    for (const text of [
      "I need food at 123 Main Street.",
      "Email me at person@example.com about groceries.",
      "Call me at 312-555-0100 about food.",
      "Coordinates are 41.878100, -87.629800.",
    ]) {
      const result = await agent.interpretNavigationNeeds(text, {
        fetch: fetcher as typeof fetch,
      });
      expect(result.status).toBe("unavailable");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses text longer than 1,200 characters without contacting a provider", async () => {
    useDeepSeek();
    const fetcher = vi.fn();
    const result = await agent.interpretNavigationNeeds("x".repeat(1201), {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns unavailable when a valid response contains no explicit suggestions", async () => {
    useDeepSeek();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      completion(modelOutput()),
    );
    const result = await agent.interpretNavigationNeeds(
      "Help me find something.",
      {
        fetch: fetcher as typeof fetch,
      },
    );
    expect(result.status).toBe("unavailable");
  });

  it("rejects provider output that tries to add origin or eligibility claims", async () => {
    useDeepSeek();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      completion({
        ...modelOutput(),
        origin: { lat: 41.88, lng: -87.62 },
        eligibilityConfirmed: true,
      }),
    );
    const result = await agent.interpretNavigationNeeds("I need food today.", {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
  });

  it("does not turn negated services into needs and prefers soon when both soon and today are stated", async () => {
    useDeepSeek();
    const routerFetch = vi.fn(async (input: RequestInfo | URL) =>
      completion(modelOutput({}, { service: "shelter" })),
    );
    const negated = await agent.interpretNavigationNeeds(
      "I do not need a shelter.",
      {
        fetch: routerFetch as typeof fetch,
      },
    );
    expect(negated.status).toBe("unavailable");

    const providerNegation = await agent.interpretNavigationNeeds(
      "I do not need shelter.",
      { fetch: routerFetch as typeof fetch },
    );
    expect(providerNegation.status).toBe("unavailable");

    const explicit = await agent.interpretNavigationNeeds(
      "I do not need shelter; I need groceries soon, ideally today.",
      { fetch: routerFetch as typeof fetch },
    );
    expect(explicit).toMatchObject({
      status: "available",
      needs: { service: "groceries", urgency: "soon" },
    });
    expect(routerFetch).toHaveBeenCalledTimes(3);
    expect(
      routerFetch.mock.calls.every(
        ([url]) => String(url) === "https://api.deepseek.com/chat/completions",
      ),
    ).toBe(true);
  });

  it("does not infer a nearby-transit preference from a negated request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "unrelated-present-fixture-key");
    const fetcher = vi.fn();
    const result = await agent.interpretNavigationNeeds(
      "I do not need a place near public transit.",
      { fetch: fetcher as typeof fetch },
    );
    expect(result.status).toBe("available");
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toMatchObject({ assistance: "computed" });
    if (result.status === "available")
      expect(result.needs?.preferTransitNearby).toBe(false);
  });

  it("uses the shared Groq client for structured preferences and needs", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "groq");
    vi.stubEnv("REACH_AI_MODEL", "test-model");
    vi.stubEnv("GROQ_API_KEY", "secret-test-key");
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        completion(
          modelOutput(
            { mode: "driving" },
            {
              service: "groceries",
              urgency: "today",
              householdSize: 4,
              hasIdentification: "no",
              preferTransitNearby: true,
            },
          ),
        ),
    );

    const result = await agent.interpretNavigationNeeds(
      "I need groceries today for a household of 4. I do not have ID. I prefer a place near public transit. I prefer driving.",
      { fetch: fetcher as typeof fetch },
    );

    expect(result).toMatchObject({
      status: "available",
      patch: { mode: "driving" },
      needs: {
        service: "groceries",
        urgency: "today",
        householdSize: 4,
        hasIdentification: "no",
        preferTransitNearby: true,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("api.groq.com");
  });
});
it("interprets near me without sending an actual position or rejecting the generic phrase", async () => {
  useDeepSeek();
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body);
    expect(body).toContain("nearby");
    expect(body).not.toContain("30.6");
    return completion(modelOutput({}, { service: "food" }));
  });
  const result = await agent.interpretNavigationNeeds("Find food near me", {
    fetch: fetcher,
  });
  expect(result).toMatchObject({ status: "available", assistance: "ai" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
