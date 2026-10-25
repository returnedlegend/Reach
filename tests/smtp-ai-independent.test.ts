import { closeCommunityDatabases } from "../src/lib/community";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openPantryDatabase,
  listPantryResources,
} from "../src/lib/pantry-store";
import { createAssistantHandler } from "../src/lib/reach-assistant";
import { interpretNavigationNeeds } from "../src/lib/navigation-needs-agent";
import { accessInput } from "./fixtures/access-scenarios";

const origin = "https://reach.example";
let directory: string;
let database: string;
let pantryId: string;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(
  body: unknown,
  options: { sameOrigin?: boolean; url?: string } = {},
) {
  return new Request(options.url || `${origin}/api/assistant`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.sameOrigin === false ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });
}

function plannedPayload(plan: ReturnType<typeof vi.fn>) {
  return plan.mock.calls.length
    ? (plan.mock.calls[0][0] as Request)
    : undefined;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-assistant-independent-"));
  database = join(directory, "community.sqlite");
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_AI_PROVIDER", "disabled");
  vi.stubEnv("REACH_EMAIL_PROVIDER", "disabled");
  const db = openPantryDatabase(database);
  pantryId = listPantryResources(db)[0].id;
});

afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent conversational assistant boundaries", () => {
  it("requires same-origin strict bounded requests and returns private no-store responses", async () => {
    const interpret = vi.fn(async () => ({
      status: "unavailable" as const,
      message: "Synthetic AI-disabled fixture.",
    }));
    const plan = vi.fn(async () =>
      json({ timezone: "America/Chicago", options: [] }),
    );
    const handle = createAssistantHandler(database, { interpret, plan });

    const crossOrigin = await handle(
      request({ message: "food", input: accessInput() }, { sameOrigin: false }),
    );
    expect(crossOrigin.status).toBe(403);
    expect(interpret).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();

    const extraField = await handle(
      request({ message: "food", unsupported: true }),
    );
    expect(extraField.status).toBe(400);
    expect(await extraField.json()).toEqual({
      error: "Check the fields and try again.",
    });

    const missingLocation = await handle(request({ message: "food today" }));
    expect(missingLocation.status).toBe(200);
    expect(missingLocation.headers.get("cache-control")).toContain("no-store");
    expect((await missingLocation.json()).status).toBe("needs-location");
    expect(interpret).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
  });

  it("uses exact user-selected coordinates only for the planner and applies only allowlisted preferences", async () => {
    const interpret = vi.fn(async () => ({
      status: "available" as const,
      assistance: "ai" as const,
      patch: {
        mode: "transit" as const,
        maxWalkingMinutes: 12,
      },
      needs: {
        service: "groceries" as const,
        urgency: "today" as const,
      },
      message: "Synthetic allowlisted preferences.",
    }));
    const plan = vi.fn(async (forwarded: Request) => {
      expect(forwarded.headers.get("origin")).toBe(origin);
      return json({ timezone: "America/Chicago", options: [] });
    });
    const handle = createAssistantHandler(database, { interpret, plan });
    const selectedOrigin = { lat: 30.612345, lng: -96.712345 };
    const base = accessInput({
      origin: selectedOrigin,
      date: "2026-10-24",
      departure: "08:00",
      appointment: "unknown",
      eligibilityConfirmed: false,
    });
    const response = await handle(
      request({ message: "I need groceries today", input: base }),
    );

    expect(response.status).toBe(200);
    const planned = plannedPayload(plan);
    expect(planned).toBeDefined();
    const payload = await planned!.json();
    expect(payload.input).toMatchObject({
      origin: selectedOrigin,
      date: "2026-10-24",
      departure: "08:00",
      appointment: "unknown",
      eligibilityConfirmed: false,
      mode: "transit",
      maxWalkingMinutes: 12,
    });
    expect(payload.needs.service).toBe("groceries");
    expect(payload.needs.urgency).toBe("today");
    expect((await response.json()).appliedPreferences).toEqual({
      mode: "transit",
      maxWalkingMinutes: 12,
    });
  });

  it("rejects model attempts to invent dates, locations, eligibility, or appointment facts", async () => {
    const interpret = vi.fn(async () => ({
      status: "available" as const,
      assistance: "ai" as const,
      patch: {
        mode: "driving" as const,
        date: "2099-01-01",
        origin: { lat: 1, lng: 2 },
        eligibilityConfirmed: true,
        appointment: "booked",
      } as unknown as Partial<ReturnType<typeof accessInput>>,
      needs: { service: "shelter" as const, stock: "available" } as never,
      message: "Synthetic malicious output.",
    }));
    const plan = vi.fn(async () =>
      json({ timezone: "America/Chicago", options: [] }),
    );
    const handle = createAssistantHandler(database, { interpret, plan });
    const base = accessInput({
      origin: { lat: 30.55, lng: -96.55 },
      date: "2026-10-24",
      mode: "walking",
      appointment: "unknown",
      eligibilityConfirmed: false,
    });
    const response = await handle(
      request({ message: "Please help with food", input: base }),
    );
    expect(response.status).toBe(200);
    const payload = await plannedPayload(plan)!.json();
    expect(payload.input).toMatchObject({
      origin: base.origin,
      date: base.date,
      mode: "walking",
      appointment: "unknown",
      eligibilityConfirmed: false,
    });
    expect(payload.needs.service).toBe("food");
    expect(payload.needs.urgency).toBe("today");
    expect((await response.json()).appliedPreferences).toEqual({});
  });

  it("never sends coordinate-bearing prose to model inference", async () => {
    vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
    vi.stubEnv("DEEPSEEK_API_KEY", "fixture-only-key");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
    const modelFetch = vi.fn();
    const interpret = (text: string, options?: { signal?: AbortSignal }) =>
      interpretNavigationNeeds(text, {
        ...options,
        fetch: modelFetch as typeof fetch,
      });
    const plan = vi.fn(async (forwarded: Request) => {
      const payload = await forwarded.json();
      expect(payload.input.origin).toEqual({ lat: 30.654321, lng: -96.654321 });
      return json({ timezone: "America/Chicago", options: [] });
    });
    const handle = createAssistantHandler(database, { interpret, plan });
    const response = await handle(
      request({
        message: "I need food near 30.123456, -96.123456",
        input: accessInput({
          origin: { lat: 30.654321, lng: -96.654321 },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(modelFetch).not.toHaveBeenCalled();
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it("returns an enrolled public pantry inquiry target without creating or sending outreach", async () => {
    const interpret = vi.fn();
    const plan = vi.fn();
    const handle = createAssistantHandler(database, { interpret, plan });
    const response = await handle(
      request({ message: "Please ask about availability", pantryId }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      assistance: "computed",
      inquiryPantryId: pantryId,
    });
    expect(interpret).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();

    const missing = await handle(
      request({ message: "Please email this pantry", pantryId: "not-public" }),
    );
    expect(missing.status).toBe(404);
    expect(plan).not.toHaveBeenCalled();
  });

  it("keeps explicitly stated shelter intent when AI interpretation is unavailable", async () => {
    const interpret = vi.fn(async () => ({
      status: "unavailable" as const,
      message: "Synthetic provider unavailable.",
    }));
    const plan = vi.fn(async () =>
      json({ timezone: "America/Chicago", options: [] }),
    );
    const handle = createAssistantHandler(database, { interpret, plan });
    const response = await handle(
      request({ message: "I need shelter today", input: accessInput() }),
    );
    expect(response.status).toBe(200);
    const payload = await plannedPayload(plan)!.json();
    expect(payload.needs.service).toBe("shelter");
    expect(payload.needs.urgency).toBe("today");
  });

  it("uses an explicitly selected Chicago departure time but asks when an evening time is unspecified", async () => {
    const interpret = vi.fn(async () => ({
      status: "unavailable" as const,
      message: "Synthetic provider unavailable.",
    }));
    const plan = vi.fn(async () =>
      json({ timezone: "America/Chicago", options: [] }),
    );
    const handle = createAssistantHandler(database, { interpret, plan });
    const selectedInput = accessInput({ departure: "17:30" });
    const explicit = await handle(
      request({
        message: "I need groceries this evening",
        departureExplicit: true,
        input: selectedInput,
      }),
    );
    expect(explicit.status).toBe(200);
    expect((await plannedPayload(plan)!.json()).input.departure).toBe("17:30");

    const before = plan.mock.calls.length;
    const unspecified = await handle(
      request({
        message: "I need groceries this evening",
        input: selectedInput,
      }),
    );
    expect(unspecified.status).toBe(200);
    expect((await unspecified.json()).status).toBe("needs-details");
    expect(plan).toHaveBeenCalledTimes(before);
  });
});
