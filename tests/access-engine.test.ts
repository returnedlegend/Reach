import { describe, expect, it } from "vitest";
import { evaluateAccess } from "../src/lib/access-engine";
import {
  accessInput, FIXED_NOW, FUTURE_DATE, journeyLookup, READY_ROUTE,
  syntheticCandidate, syntheticJourney, syntheticWindow,
} from "./fixtures/access-scenarios";

describe("deterministic food access evaluation (synthetic fixtures only)", () => {
  it("ranks a farther open service above a nearby pantry that closes before arrival", async () => {
    const near = syntheticCandidate("near", { name: "Near, closing early", coordinates: { lat: 30, lng: -96.01 }, window: syntheticWindow({ opens: "08:00", closes: "08:30", registrationCutoff: "08:25" }) });
    const far = syntheticCandidate("far", { name: "Far, open later", coordinates: { lat: 30, lng: -96.02 } });
    const response = await evaluateAccess(accessInput(), [near, far], journeyLookup({
      "-96.0100": [syntheticJourney({ arrival: 520 })], "-96.0200": [syntheticJourney({ arrival: 525, walkingMinutes: 14, walkingMiles: 0.7 })],
    }), FIXED_NOW);
    expect(response.options.map(x => x.id)).toEqual(["far", "near"]);
    expect(response.options[0].status).toBe("fits");
    expect(response.options[1].status).toBe("no");
  });

  it("applies arrival buffer, registration cutoff, and visit completion as separate timing limits", async () => {
    const candidate = syntheticCandidate("tight", { window: syntheticWindow({ opens: "08:30", closes: "09:00", registrationCutoff: "08:40" }) });
    const response = await evaluateAccess(accessInput({ arrivalBufferMinutes: 15, visitMinutes: 20 }), [candidate], journeyLookup({ "-96.0100": [syntheticJourney({ arrival: 510 })] }), FIXED_NOW);
    expect(response.options[0].status).toBe("no");
    expect(response.options[0].reasons.join(" ")).toMatch(/cutoff|finish the visit/i);
  });

  it("keeps missing schedule, eligibility, stock, step-free access, and conflicting sources in confirm", async () => {
    const candidate = syntheticCandidate("uncertain", {
      window: null, availability: { status: "unknown", source: "old synthetic report", reportedAt: "2026-10-20T00:00:00.000Z", expiresAt: "2026-10-21T00:00:00.000Z" },
      pedestrianPickup: "unknown", eligibility: "Unknown", accessibility: "Not verified",
    });
    const response = await evaluateAccess(accessInput({ mobility: "step-free", eligibilityConfirmed: false, dietaryRequired: true }), [candidate], journeyLookup({ "-96.0100": [READY_ROUTE] }), FIXED_NOW);
    expect(response.options[0].status).toBe("confirm");
    expect(response.options[0].warnings.join(" ")).toMatch(/availability is unknown/i);
    expect(response.options[0].warnings.join(" ")).toMatch(/eligibility/i);
    expect(response.options[0].warnings.join(" ")).toMatch(/dietary/i);
    expect(response.options[0].warnings.join(" ")).toMatch(/Step-free/i);
    expect(response.options[0].warnings.join(" ")).toMatch(/Pedestrian pickup/i);
    expect(response.options[0].reasons.join(" ")).toMatch(/hours.*not verified/i);

    const conflict = syntheticCandidate("conflict", { conflictingSources: true });
    const conflictResponse = await evaluateAccess(accessInput(), [conflict], journeyLookup({ "-96.0100": [READY_ROUTE] }), FIXED_NOW);
    expect(conflictResponse.options[0].status).toBe("confirm");
    expect(conflictResponse.options[0].warnings.join(" ")).toMatch(/requires confirmation/i);
  });

  it("does not route to a pantry with a fresh report of unavailable food", async () => {
    const candidate = syntheticCandidate("empty", { availability: { status: "unavailable", source: "Synthetic live report", reportedAt: "2026-10-22T10:00:00.000Z", expiresAt: "2026-10-24T00:00:00.000Z" } });
    let calls = 0;
    const lookup = async () => { calls++; return [READY_ROUTE]; };
    const response = await evaluateAccess(accessInput(), [candidate], lookup, FIXED_NOW);
    expect(response.options[0].status).toBe("no");
    expect(calls).toBe(1); // Availability is checked against the expected arrival instant.
  });

  it("downgrades a report that is fresh at search time but expires before arrival", async () => {
    const candidate = syntheticCandidate("expires-during-trip", { availability: {
      status: "available", source: "Synthetic short-lived report", reportedAt: "2026-10-22T11:30:00.000Z",
      expiresAt: "2026-10-23T13:45:00.000Z",
    } });
    const response = await evaluateAccess(accessInput(), [candidate], journeyLookup({
      "-96.0100": [syntheticJourney({ arrival: 540 })],
    }), FIXED_NOW);
    expect(response.options[0].status).toBe("confirm");
    expect(response.options[0].availability.status).toBe("unknown");
    expect(response.options[0].warnings.join(" ")).toMatch(/expected service time/i);
  });

  it("enforces complete-trip walking time, walking distance, transfer, and fare budgets", async () => {
    const candidate = syntheticCandidate("costly");
    const cases = [
      [accessInput({ maxWalkingMinutes: 10 }), syntheticJourney({ walkingMinutes: 11 })],
      [accessInput({ maxWalkingMiles: 0.5 }), syntheticJourney({ walkingMiles: 0.6 })],
      [accessInput({ maxTransfers: 0 }), syntheticJourney({ transfers: 1 })],
      [accessInput({ fareBudget: 2 }), syntheticJourney({ fare: 3 })],
    ] as const;
    for (const [input, route] of cases) {
      const response = await evaluateAccess(input, [candidate], journeyLookup({ "-96.0100": [route] }), FIXED_NOW);
      expect(response.options[0].status).toBe("no");
    }
  });

  it("requires a booked appointment and labels an unconfirmed required appointment", async () => {
    const candidate = syntheticCandidate("appointment", { window: syntheticWindow({ appointmentRequired: true }) });
    const no = await evaluateAccess(accessInput({ appointment: "not-booked" }), [candidate], journeyLookup({ "-96.0100": [READY_ROUTE] }), FIXED_NOW);
    const unsure = await evaluateAccess(accessInput({ appointment: "unknown" }), [candidate], journeyLookup({ "-96.0100": [READY_ROUTE] }), FIXED_NOW);
    const booked = await evaluateAccess(accessInput({ appointment: "booked" }), [candidate], journeyLookup({ "-96.0100": [READY_ROUTE] }), FIXED_NOW);
    expect(no.options[0].status).toBe("no");
    expect(unsure.options[0].status).toBe("confirm");
    expect(booked.options[0].status).toBe("fits");
  });

  it("reports an unavailable requested return as unconfirmed instead of a one-way fit", async () => {
    const candidate = syntheticCandidate("return", { coordinates: { lat: 30, lng: -96.01 } });
    const response = await evaluateAccess(accessInput({ returnTo: { lat: 30, lng: -96.03 }, returnDeadline: "12:00" }), [candidate], journeyLookup({ "-96.0100": [READY_ROUTE], "-96.0300": [] }), FIXED_NOW);
    expect(response.options[0].status).toBe("confirm");
    expect(response.options[0].returnJourney).toBeNull();
    expect(response.options[0].reasons.join(" ")).toMatch(/return journey is unavailable/i);
  });

  it("rejects a trip when the outbound fare is unknown but the known return fare exceeds budget", async () => {
    const candidate = syntheticCandidate("one-way-unknown-fare", { coordinates: { lat: 30, lng: -96.01 } });
    const response = await evaluateAccess(
      accessInput({ fareBudget: 2, returnTo: { lat: 30, lng: -96.03 }, returnDeadline: "12:00" }),
      [candidate],
      journeyLookup({
        "-96.0100": [syntheticJourney({ fare: null, arrival: 510 })],
        "-96.0300": [syntheticJourney({ departure: 560, arrival: 590, fare: 5 })],
      }),
      FIXED_NOW,
    );
    expect(response.options[0].status).toBe("no");
    expect(response.options[0].reasons.join(" ")).toMatch(/fare budget/i);
  });

  it("rejects a visit that would finish after the requested return deadline", async () => {
    const candidate = syntheticCandidate("visit-after-deadline", {
      window: syntheticWindow({ opens: "11:00", closes: "13:00", registrationCutoff: "12:45" }),
      coordinates: { lat: 30, lng: -96.01 },
    });
    const response = await evaluateAccess(
      accessInput({ departure: "11:00", arrivalBufferMinutes: 0, visitMinutes: 30,
        returnTo: { lat: 30, lng: -96.03 }, returnDeadline: "12:00" }),
      [candidate],
      async (_from, to, earliest, latest) => {
        if (to.lng === -96.01) return [syntheticJourney({ departure: 660, arrival: 700 })];
        return earliest <= latest ? [syntheticJourney({ departure: earliest, arrival: earliest + 10 })] : [];
      },
      FIXED_NOW,
    );
    expect(response.options[0].status).toBe("no");
    expect(response.options[0].serviceEnd).toBeNull();
    expect(response.options[0].reasons.join(" ")).toMatch(/return deadline/i);
  });

  it("matches an explicit next-day service window and honors a 25:00 return deadline", async () => {
    const candidate = syntheticCandidate("overnight", { window: syntheticWindow({
      rule: { kind: "dates", dates: ["2026-10-24"] }, opens: "00:00", closes: "02:00", registrationCutoff: "01:30",
    }) });
    const out = syntheticJourney({ departure: 1410, arrival: 1430 });
    const back = syntheticJourney({ departure: 1470, arrival: 1500 });
    const response = await evaluateAccess(accessInput({ departure: "23:30", returnTo: { lat: 30, lng: -96.03 }, returnDeadline: "25:00" }), [candidate], journeyLookup({ "-96.0100": [out], "-96.0300": [back] }), FIXED_NOW);
    expect(response.options[0].status).toBe("fits");
    expect(response.options[0].serviceStart).toBe(1440);
    expect(response.options[0].returnJourney?.arrival).toBe(1500);
  });

  it("treats the daylight-saving transition date as uncertain when the route provider flags it", async () => {
    const candidate = syntheticCandidate("dst", { window: syntheticWindow({ rule: { kind: "dates", dates: ["2026-11-01"] } }) });
    const response = await evaluateAccess(accessInput({ date: "2026-11-01" }), [candidate], journeyLookup({ "-96.0100": [syntheticJourney({ warnings: ["Chicago clock changes during this service day; confirm times."] })] }), FIXED_NOW);
    expect(response.options[0].status).toBe("confirm");
    expect(response.options[0].warnings.join(" ")).toMatch(/clock changes/i);
  });
});
