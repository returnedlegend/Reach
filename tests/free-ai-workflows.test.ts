import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
const appOrigin = "https://reach.example.org";
const actualModel = "fixture/grounded:free";
const catalogEntry = (id: string) => ({
  id,
  pricing: { prompt: "0", completion: "0", request: "0" },
  supported_parameters: ["tools", "structured_outputs"],
});
function provider(output: unknown) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url).startsWith("https://openrouter.ai/api/v1/")).toBe(true);
    if (String(url).endsWith("/models"))
      return Response.json({
        data: [catalogEntry("openrouter/free"), catalogEntry(actualModel)],
      });
    expect(JSON.parse(String(init?.body)).model).toBe("openrouter/free");
    return Response.json({
      model: actualModel,
      usage: { cost: 0 },
      choices: [{ message: { content: JSON.stringify(output) } }],
    });
  });
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T13:00:00Z"));
  directory = mkdtempSync(join(tmpdir(), "reach-free-workflow-"));
  for (const [key, value] of Object.entries({
    REACH_APP_ORIGIN: appOrigin,
    REACH_AI_PROVIDER: "openrouter",
    REACH_AI_DATA_POLICY_ACCEPTED: "true",
    REACH_AI_FREE_ONLY: "true",
    REACH_AI_ALLOW_PAID: "false",
    REACH_AI_GEMINI_FALLBACK: "false",
    OPENROUTER_API_KEY: "synthetic-test-key",
    OPENROUTER_MODEL: "",
    OPENROUTER_FAST_MODEL: "",
    OPENROUTER_PRIMARY_MODEL: "",
    OPENROUTER_FALLBACK_MODEL: "",
    REACH_AI_MODEL: "",
    REACH_AI_FAST_MODEL: "",
    REACH_AI_PRIMARY_MODEL: "",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OSM_ROUTER_MODE: "disabled",
    REACH_EMAIL_PROVIDER: "disabled",
  }))
    vi.stubEnv(key, value);
});
afterEach(async () => {
  const { closeCommunityDatabases } = await import("../src/lib/community");
  closeCommunityDatabases();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

describe("free router connected to existing workflows", () => {
  it("interprets transit preferences while real directory records and unavailable route facts remain under planner control", async () => {
    const fetcher = provider({
      patch: {
        maxWalkingMinutes: 10,
        maxWalkingMiles: null,
        fareBudget: null,
        mode: "transit",
        maxTransfers: null,
        visitMinutes: null,
        mobility: null,
        allowWaiting: null,
        dietaryPreference: null,
        dietaryRequired: null,
      },
      needs: {
        service: "groceries",
        urgency: "today",
        householdSize: null,
        hasIdentification: null,
        preferTransitNearby: null,
      },
    });
    vi.stubGlobal("fetch", fetcher);
    const { createAssistantHandler } = await import(
      "../src/lib/reach-assistant"
    );
    const { openPantryDatabase, listPantryResources } = await import(
      "../src/lib/pantry-store"
    );
    const database = join(directory, "community.sqlite");
    const records = listPantryResources(openPantryDatabase(database));
    const origin = { lat: 30.674321, lng: -96.376789 };
    const response = await createAssistantHandler(database)(
      new Request(`${appOrigin}/api/assistant`, {
        method: "POST",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          message: "Find groceries by bus; I can walk 10 minutes.",
          departureExplicit: true,
          input: {
            origin,
            date: "2026-10-23",
            departure: "08:10",
            mode: "walking",
            maxWalkingMinutes: 20,
            maxWalkingMiles: 1,
            fareBudget: 5,
            maxTransfers: 2,
            mobility: "standard",
            appointment: "unknown",
            eligibilityConfirmed: false,
            dietaryPreference: "none",
            dietaryRequired: false,
            visitMinutes: 30,
            arrivalBufferMinutes: 15,
            allowWaiting: true,
          },
        }),
      }),
    );
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.assistance).toBe("ai");
    expect(result.appliedPreferences).toMatchObject({
      mode: "transit",
      maxWalkingMinutes: 10,
    });
    expect(result.reply).toContain("could not confirm a workable trip");
    expect(result.plan.options.length).toBeGreaterThan(0);
    for (const option of result.plan.options) {
      const maintained = records.find((record) => record.id === option.id);
      expect(maintained).toBeDefined();
      expect(option.resource.coordinates).toEqual(maintained!.coordinates);
      expect(option.outbound).toBeNull();
      expect(option.availability.status).toBe("unknown");
    }
    const inference = fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith("/chat/completions"),
    );
    expect(inference.length).toBeGreaterThan(0);
    for (const [, request] of inference) {
      expect(String(request?.body)).not.toContain(String(origin.lat));
      expect(String(request?.body)).not.toContain(String(origin.lng));
    }
  });

  it("generates an editable inquiry draft through the same free router without sending email", async () => {
    const question = "Can you share current availability?";
    const body = `Hello Pantry,\n\nReach is sending an AI-assisted inquiry on a user's behalf. The user is checking current availability and pickup details. Could you please help with this question: ${question}\n\nThank you.`;
    const fetcher = provider({
      subject: "Question about current availability",
      body,
    });
    const { generateOutreachDraft } = await import("../src/lib/access-ai");
    const draft = await generateOutreachDraft(
      { recipientName: "Pantry", question },
      { fetch: fetcher as typeof fetch },
    );
    expect(draft.assistance).toBe("ai");
    expect(draft.body).toContain(question);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/chat/completions"),
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("https://openrouter.ai/"),
      ),
    ).toBe(true);
  });

  it("keeps editable template drafts available without an AI key and makes no provider request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetcher = vi.fn();
    const { generateOutreachDraft } = await import("../src/lib/access-ai");
    const draft = await generateOutreachDraft(
      {
        recipientName: "Pantry",
        question: "What are your pickup requirements?",
      },
      { fetch: fetcher },
    );
    expect(draft.assistance).toBe("template");
    expect(draft.body).toContain("What are your pickup requirements?");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
