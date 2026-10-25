import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
const appOrigin = "https://reach.example.org";
function provider(output: unknown) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init?.body)).model).toBe("deepseek-flash");
    return Response.json({
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
    REACH_AI_PROVIDER: "deepseek",
    REACH_AI_DATA_POLICY_ACCEPTED: "true",
    DEEPSEEK_API_KEY: "synthetic-test-key",
    DEEPSEEK_MODEL: "deepseek-flash",
    DEEPSEEK_REASONING_MODEL: "deepseek-v4-pro",
    REACH_AI_MODEL: "",
    REACH_AI_FAST_MODEL: "",
    REACH_AI_PRIMARY_MODEL: "",
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

describe("DeepSeek connected to existing workflows", () => {
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

  it("generates an editable inquiry draft through DeepSeek without sending email", async () => {
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
        String(url).startsWith("https://api.deepseek.com/"),
      ),
    ).toBe(true);
  });

  it("keeps editable template drafts available without an AI key and makes no provider request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
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
