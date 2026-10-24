import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let agent: typeof import("../src/lib/navigation-needs-agent");

beforeEach(async () => {
  vi.resetModules();
  agent = await import("../src/lib/navigation-needs-agent");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function useOpenRouter() {
  vi.stubEnv("REACH_AI_PROVIDER", "openrouter");
  vi.stubEnv("REACH_AI_FAST_MODEL", "test/needs:free");
  vi.stubEnv("OPENROUTER_API_KEY", "secret-test-key");
  vi.stubEnv("REACH_AI_FREE_ONLY", "true");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function freeCatalog() {
  return jsonResponse({
    data: [
      {
        id: "test/needs:free",
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools", "structured_outputs"],
      },
    ],
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
  it("uses one strict OpenRouter structured response and removes nullable leaves", async () => {
    useOpenRouter();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/models")
          ? freeCatalog()
          : completion(
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    const schema = request.response_format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
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
    useOpenRouter();
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
    useOpenRouter();
    const fetcher = vi.fn();
    const result = await agent.interpretNavigationNeeds("x".repeat(1201), {
      fetch: fetcher as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns unavailable when a valid response contains no explicit suggestions", async () => {
    useOpenRouter();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/models")
        ? freeCatalog()
        : completion(modelOutput()),
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
    useOpenRouter();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/models")
        ? freeCatalog()
        : completion({
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
    useOpenRouter();
    const routerFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/models")
        ? freeCatalog()
        : completion(modelOutput({}, { service: "shelter" })),
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
    expect(routerFetch).toHaveBeenCalledTimes(4);
    expect(
      routerFetch.mock.calls.filter(([url]) => String(url).endsWith("/models")),
    ).toHaveLength(1);
    expect(
      routerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith("/chat/completions"),
      ),
    ).toHaveLength(3);
  });

  it("does not infer a nearby-transit preference from a negated request", async () => {
    const result = await agent.interpretNavigationNeeds(
      "I do not need a place near public transit.",
      { fetch: vi.fn() as typeof fetch },
    );
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.needs?.preferTransitNearby).toBe(false);
  });

  it("preserves the existing Groq preference path and supplements only clear typed needs", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "groq");
    vi.stubEnv("REACH_AI_MODEL", "test-model");
    vi.stubEnv("GROQ_API_KEY", "secret-test-key");
    vi.stubEnv("REACH_AI_FREE_ONLY", "false");
    vi.stubEnv("REACH_AI_ALLOW_PAID", "true");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        completion({ mode: "driving" }),
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
