import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ACCESS_WEIGHTS, evaluateAccess } from "../src/lib/access-engine";
import { buildNavigationGuidance } from "../src/lib/navigation-guidance-agent";
import { navigationWeights } from "../src/lib/navigation-ranking-agent";
import type { AccessOption, AccessResponse } from "../src/lib/access-types";
import { DEFAULT_NAVIGATION_NEEDS } from "../src/lib/navigation-types";
import {
  accessInput,
  FIXED_NOW,
  journeyLookup,
  syntheticCandidate,
  syntheticJourney,
} from "./fixtures/access-scenarios";

const outputSchema = z.object({ ok: z.boolean() }).strict();

const freeModel = {
  id: "fixture/primary:free",
  pricing: { prompt: "0", completion: "0", request: "0" },
  supported_parameters: ["tools", "structured_outputs"],
};

function configureGuidance() {
  vi.stubEnv("REACH_AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_PRIMARY_MODEL", "fixture/primary:free");
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-only-key");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  vi.stubEnv("REACH_AI_FREE_ONLY", "true");
}

function catalog(models = [freeModel]) {
  return new Response(JSON.stringify({ data: models }), { status: 200 });
}

function completion(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(
    JSON.stringify(
      status >= 200 && status < 300
        ? { choices: [{ message: { content: JSON.stringify(value) } }] }
        : {},
    ),
    { status, headers },
  );
}

function option(
  id: string,
  kind: "pantry" | "household",
  status: AccessOption["status"],
): AccessOption {
  const candidate = syntheticCandidate(id);
  candidate.resource.name = `Synthetic ${id}`;
  candidate.resource.address = `PRIVATE_FIXTURE_ADDRESS_${id}`;
  candidate.resource.phone = `PRIVATE_FIXTURE_PHONE_${id}`;
  return {
    id,
    kind,
    resource: candidate.resource,
    status,
    reasons: [`Synthetic ${status} reason for ${id}.`],
    warnings: [`Synthetic warning for ${id}.`],
    labels: [],
    availability: { ...candidate.availability, status: "unknown" },
    outbound: syntheticJourney({
      departure: 480,
      arrival: 510,
      walkingMinutes: 12,
      walkingMiles: 0.7,
      fare: 0,
      steps: [`Synthetic route step for ${id}.`],
    }),
    returnJourney: null,
    serviceStart: 550,
    serviceEnd: 570,
    intakeCutoff: 690,
    score: status === "fits" ? 5 : -10,
  };
}

function response(options: AccessOption[]): AccessResponse {
  return {
    timezone: "America/Chicago",
    options,
    searchedAt: "2026-10-22T12:00:00.000Z",
    routingCalls: 1,
    aiCalls: 0,
    message: "Synthetic navigation fixture only.",
  };
}

describe("independent navigation safety checks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("keeps hard service-window failures out of the recommendation despite urgent weights", async () => {
    const candidate = syntheticCandidate("synthetic-closing-soon");
    const lateLookup = journeyLookup({
      "-96.0100": [
        syntheticJourney({ departure: 680, arrival: 710, walkingMinutes: 5 }),
      ],
    });
    const input = accessInput({
      departure: "11:20",
      allowWaiting: true,
      visitMinutes: 20,
    });
    const result = await evaluateAccess(
      input,
      [candidate],
      lateLookup,
      FIXED_NOW,
      navigationWeights(
        { ...DEFAULT_NAVIGATION_NEEDS, urgency: "soon" },
        input.mode,
      ),
    );

    expect(result.options).toHaveLength(1);
    expect(result.options[0].status).toBe("no");
    expect(result.options[0].reasons.join(" ")).toMatch(/finish the visit before/i);
  });

  it("does not represent an unknown driving cost as zero or reject the driver's route for pedestrian-only rules", async () => {
    const candidate = syntheticCandidate("synthetic-driver", {
      pedestrianPickup: "not-allowed",
    });
    const input = accessInput({ mode: "driving", fareBudget: 0 });
    const driving = syntheticJourney({
      mode: "driving",
      departure: 480,
      arrival: 510,
      durationMinutes: 30,
      distanceMiles: 12,
      walkingMinutes: 0,
      walkingMiles: 0,
      fare: null,
    });
    const result = await evaluateAccess(
      input,
      [candidate],
      journeyLookup({ "-96.0100": [driving] }),
      FIXED_NOW,
    );

    expect(result.options[0].status).toBe("confirm");
    expect(result.options[0].outbound?.mode).toBe("driving");
    expect(result.options[0].labels).not.toContain("No travel fare");
    expect(result.options[0].warnings.join(" ")).toMatch(/fuel, parking.*unknown/i);
    expect(result.options[0].reasons.join(" ")).not.toMatch(/pedestrian pickup/i);
  });

  it("keeps a routed confirmation ahead of an un-routed option under extreme score weights", async () => {
    const routed = syntheticCandidate("synthetic-routed", {
      availability: {
        status: "unknown",
        source: "Synthetic unknown stock",
        reportedAt: null,
        expiresAt: null,
      },
    });
    const unRouted = syntheticCandidate("synthetic-unrouted", {
      coordinates: null,
      availability: {
        status: "unknown",
        source: "Synthetic unknown stock",
        reportedAt: null,
        expiresAt: null,
      },
    });
    const input = accessInput();
    const route = syntheticJourney({
      departure: 480,
      arrival: 540,
      walkingMinutes: 30,
      walkingMiles: 1,
      fare: 0,
    });
    const weights = {
      ...ACCESS_WEIGHTS,
      travelMinute: 1000,
      walkingMinute: 0,
      dollar: 0,
      transfer: 0,
      uncertainty: 0,
      closingSlackMinute: 0,
      waitingMinute: 0,
    };
    const result = await evaluateAccess(
      input,
      [unRouted, routed],
      journeyLookup({ "-96.0100": [route] }),
      FIXED_NOW,
      weights,
    );

    expect(result.options.map((candidate) => candidate.id)).toEqual([
      "synthetic-routed",
      "synthetic-unrouted",
    ]);
    expect(result.options[0].status).toBe("confirm");
    expect(result.options[0].outbound).not.toBeNull();
    expect(result.options[1].outbound).toBeNull();
  });

  it("keeps guidance tied to the deterministically selected public option and excludes coordinates, profile, and household details from the model prompt", async () => {
    configureGuidance();
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
    const publicOption = option("synthetic-public", "pantry", "fits");
    const householdOption = option("synthetic-household", "household", "fits");
    householdOption.resource.address = "PRIVATE_HOUSEHOLD_COORDINATE_POINT";
    const noOption = option("synthetic-infeasible", "pantry", "no");
    const plan = response([noOption, publicOption, householdOption]);
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/models")) return catalog();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return completion({ emphasisIds: ["option-1-route", "option-1-food"] });
    });
    const origin = { lat: 79.123456, lng: -119.123456 };
    const privateReturn = { lat: 78.987654, lng: -118.987654 };
    const guidance = await buildNavigationGuidance(
      plan,
      accessInput({ origin, returnTo: privateReturn, returnDeadline: "30:00" }),
      {
        ...DEFAULT_NAVIGATION_NEEDS,
        householdSize: 7,
        hasIdentification: "no",
      },
      { explain: true, fetch: fetcher as typeof fetch },
    );

    expect(guidance).toMatchObject({
      selectedId: "synthetic-public",
      assistance: "ai",
      status: "ready",
      alternativeIds: ["synthetic-household"],
    });
    expect(guidance.modules.find((module) => module.name === "resources")?.status).toBe("limited");
    expect(guidance.paragraphs.join(" ")).toContain("Routed walking");
    expect(guidance.paragraphs.join(" ")).toContain("Synthetic synthetic-infeasible was excluded");
    expect(guidance.selectedId).not.toBe("synthetic-infeasible");
    expect(guidance.alternativeIds).not.toContain("synthetic-infeasible");
    expect(bodies).toHaveLength(1);
    const prompt = JSON.stringify(bodies[0]);
    expect(prompt).toContain("Routed walking: leave 8:00 AM, arrive 8:30 AM");
    expect(prompt).not.toContain("Synthetic route step for synthetic-public");
    expect(prompt).not.toContain("79.123456");
    expect(prompt).not.toContain("-119.123456");
    expect(prompt).not.toContain("78.987654");
    expect(prompt).not.toContain("PRIVATE_HOUSEHOLD_COORDINATE_POINT");
    expect(prompt).not.toContain("PRIVATE_FIXTURE_ADDRESS");
    expect(prompt).not.toContain("PRIVATE_FIXTURE_PHONE");
    expect(prompt).not.toContain('"householdSize"');
    expect(prompt).not.toContain('"hasIdentification"');
    expect(prompt).not.toContain("Synthetic no reason");
  });

  it("rejects model-emphasized IDs outside the eligible public evidence and preserves the computed explanation", async () => {
    configureGuidance();
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
    const publicOption = option("synthetic-public", "pantry", "fits");
    const householdOption = option("synthetic-private", "household", "fits");
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/models")
        ? catalog()
        : completion({ emphasisIds: ["option-1-route"] }),
    );
    const guidance = await buildNavigationGuidance(
      response([publicOption, householdOption]),
      accessInput(),
      DEFAULT_NAVIGATION_NEEDS,
      { explain: true, fetch: fetcher as typeof fetch },
    );

    expect(guidance.selectedId).toBe("synthetic-public");
    expect(guidance.assistance).toBe("deterministic");
    expect(guidance.paragraphs.join(" ")).toContain("Routed walking");
    expect(guidance.paragraphs.join(" ")).not.toContain("synthetic-private");
  });

  it("charges each fallback completion attempt against the feature budget", async () => {
    vi.resetModules();
    const client = await import("../src/lib/openrouter-client");
    configureGuidance();
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "fixture/fallback:free");
    vi.stubEnv("REACH_AI_GUIDANCE_DAILY_LIMIT", "1");
    const models = [freeModel, { ...freeModel, id: "fixture/fallback:free" }];
    let completions = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/models")) return catalog(models);
      completions += 1;
      return completion(null, 503);
    });
    const run = () =>
      client.openRouterJson({
        role: "primary",
        feature: "guidance",
        prompt: "synthetic fixture",
        jsonSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
        schema: outputSchema,
        fetch: fetcher as typeof fetch,
      });
    const first = await run();
    const second = await run();

    expect(first.status).toBe("unavailable");
    expect(second.status).toBe("unavailable");
    expect(completions).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2); // one catalog request and one completion attempt
  });

  it("honors a long Retry-After on a transient 503 instead of immediately calling fallback", async () => {
    vi.resetModules();
    const client = await import("../src/lib/openrouter-client");
    configureGuidance();
    vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "fixture/fallback:free");
    const models = [freeModel, { ...freeModel, id: "fixture/fallback:free" }];
    let completions = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/models")) return catalog(models);
      completions += 1;
      return completion(null, 503, { "retry-after": "5" });
    });
    const result = await client.openRouterJson({
      role: "primary",
      feature: "guidance",
      prompt: "synthetic fixture",
      jsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      schema: outputSchema,
      fetch: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({ status: "unavailable", calls: 1 });
    expect(completions).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
