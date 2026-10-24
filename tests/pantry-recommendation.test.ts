import { describe, it, expect } from "vitest";
import { buildNavigationGuidance } from "../src/lib/navigation-guidance-agent";
import { evaluateAccess } from "../src/lib/access-engine";
import { recommendPantry } from "../src/lib/pantry-recommendation";
import {
  accessInput,
  FIXED_NOW,
  journeyLookup,
  syntheticCandidate,
  syntheticJourney,
  syntheticWindow,
} from "./fixtures/access-scenarios";
const search = { siteLimit: 8, routeLimitReached: false };
describe("deterministic pantry recommendation", () => {
  it("keeps guidance bound to the deterministic recommendation, including an explicit no-recommendation result", async () => {
    const input = accessInput();
    const result = await evaluateAccess(
      input,
      [syntheticCandidate("a"), syntheticCandidate("b")],
      journeyLookup({ "-96.0100": [syntheticJourney()] }),
      FIXED_NOW,
    );
    result.recommendation = recommendPantry(result, input, {
      ...search,
      destinationId: "b",
    });
    const declared = {
      service: "food" as const,
      urgency: "today" as const,
      hasIdentification: "unknown" as const,
      preferTransitNearby: false,
    };
    const guidance = await buildNavigationGuidance(result, input, declared, {
      explain: false,
    });
    expect(result.options[0].id).toBe("a");
    expect(guidance.selectedId).toBe("b");
    result.recommendation = {
      ...result.recommendation,
      selectedId: null,
      status: "unavailable",
    };
    const unavailable = await buildNavigationGuidance(result, input, declared, {
      explain: false,
    });
    expect(unavailable.selectedId).toBeNull();
  });

  it("surfaces a lower-score tradeoff ahead of several dominated alternatives", async () => {
    const candidates = [
      "best",
      "dominated1",
      "dominated2",
      "dominated3",
      "tradeoff",
    ].map((id, i) =>
      syntheticCandidate(id, {
        coordinates: { lat: 30, lng: -96.01 - i * 0.01 },
      }),
    );
    const routes = Object.fromEntries(
      candidates.map((c, i) => [
        c.resource.coordinates!.lng.toFixed(4),
        [
          syntheticJourney(
            i === 4
              ? { arrival: 540, walkingMinutes: 1, fare: 20 }
              : { arrival: 500 + i, walkingMinutes: 10, fare: 0 },
          ),
        ],
      ]),
    );
    const input = accessInput();
    const result = await evaluateAccess(
      input,
      candidates,
      journeyLookup(routes),
      FIXED_NOW,
    );
    expect(result.options.findIndex((o) => o.id === "tradeoff")).toBe(4);
    const rec = recommendPantry(result, input, search);
    expect(rec.selectedId).toBe("best");
    expect(rec.paretoFrontierIds).toContain("tradeoff");
    expect(rec.alternativeIds[0]).toBe("tradeoff");
  });

  it("prefers a better retrieved trip over straight-line proximity and explains the real score", async () => {
    const input = accessInput();
    const r = await evaluateAccess(
      input,
      [
        syntheticCandidate("near"),
        syntheticCandidate("far", { coordinates: { lat: 30, lng: -96.02 } }),
      ],
      journeyLookup({
        "-96.0100": [syntheticJourney({ arrival: 550, walkingMinutes: 45 })],
        "-96.0200": [syntheticJourney({ arrival: 500, walkingMinutes: 20 })],
      }),
      FIXED_NOW,
    );
    const rec = recommendPantry(r, input, search);
    expect(rec.selectedId).toBe("far");
    expect(rec.status).toBe("ready");
    const o = r.options.find((o) => o.id === "far")!,
      s = o.scoreBreakdown!;
    expect(o.score).toBeCloseTo(
      s.closingBufferBonus -
        s.travelPenalty -
        s.walkingPenalty -
        s.farePenalty -
        s.transferPenalty -
        s.uncertaintyPenalty -
        s.waitingPenalty -
        s.serviceDelayPenalty,
    );
    expect(rec.paretoFrontierIds).toContain("far");
    expect(rec.explanation.join(" ")).toContain("not success probabilities");
  });
  it("never selects an unverified site or a route without recorded distribution timing", async () => {
    const input = accessInput();
    const r = await evaluateAccess(
      input,
      [
        syntheticCandidate("unverified", {
          verificationStatus: "needs-confirmation",
        }),
        syntheticCandidate("unknown-hours", { window: null }),
      ],
      journeyLookup({ "-96.0100": [syntheticJourney()] }),
      FIXED_NOW,
    );
    const rec = recommendPantry(r, input, search);
    expect(rec.selectedId).toBeNull();
    expect(rec.status).toBe("unavailable");
    expect(rec.comparison.unverifiedPantries).toBe(1);
    expect(rec.comparison.complete).toBe(false);
  });
  it("does not recommend a one-way journey when a return was requested", async () => {
    const input = accessInput({
      returnTo: { lat: 30, lng: -96.03 },
      returnDeadline: "12:00",
    });
    const r = await evaluateAccess(
      input,
      [syntheticCandidate("missing-return")],
      journeyLookup({ "-96.0100": [syntheticJourney()] }),
      FIXED_NOW,
    );
    expect(r.options[0].outbound).not.toBeNull();
    expect(recommendPantry(r, input, search).selectedId).toBeNull();
  });
  it("retains alternatives with different travel/cost tradeoffs and never turns unknown fare into zero", async () => {
    const input = accessInput();
    const r = await evaluateAccess(
      input,
      [
        syntheticCandidate("fast-expensive"),
        syntheticCandidate("slow-free", {
          coordinates: { lat: 30, lng: -96.02 },
        }),
        syntheticCandidate("unknown-fare", {
          coordinates: { lat: 30, lng: -96.03 },
        }),
      ],
      journeyLookup({
        "-96.0100": [
          syntheticJourney({ arrival: 495, fare: 5, walkingMinutes: 5 }),
        ],
        "-96.0200": [
          syntheticJourney({ arrival: 530, fare: 0, walkingMinutes: 5 }),
        ],
        "-96.0300": [
          syntheticJourney({ arrival: 495, fare: null, walkingMinutes: 5 }),
        ],
      }),
      FIXED_NOW,
    );
    const rec = recommendPantry(r, input, search);
    expect(rec.paretoFrontierIds).toEqual(
      expect.arrayContaining(["fast-expensive", "slow-free"]),
    );
    expect(
      r.options.find((o) => o.id === "unknown-fare")!.scoreBreakdown!.totalFare,
    ).toBeNull();
    expect(rec.selectedId).not.toBe("unknown-fare");
  });
  it("reports an incomplete search when any route/window is unresolved or a budget was reached", async () => {
    const input = accessInput();
    const r = await evaluateAccess(
      input,
      [
        syntheticCandidate("checked"),
        syntheticCandidate("unresolved", {
          coordinates: { lat: 30, lng: -96.02 },
        }),
      ],
      journeyLookup({ "-96.0100": [syntheticJourney()] }),
      FIXED_NOW,
    );
    const rec = recommendPantry(r, input, {
      ...search,
      routeLimitReached: true,
    });
    expect(rec.comparison.complete).toBe(false);
    expect(rec.comparison.unresolvedPantries).toBe(1);
    expect(rec.comparison.routeLimitReached).toBe(true);
    expect(rec.explanation.join(" ")).toContain(
      "Another pantry could be better",
    );
  });
  it("rejects impossible registration or unbooked appointments before spending route requests", async () => {
    let calls = 0;
    const lookup = async () => {
      calls++;
      return [syntheticJourney()];
    };
    const r = await evaluateAccess(
      accessInput({ appointment: "not-booked" }),
      [
        syntheticCandidate("too-late", {
          window: syntheticWindow({
            opens: "07:00",
            closes: "08:20",
            registrationCutoff: "08:05",
          }),
        }),
        syntheticCandidate("appointment", {
          window: syntheticWindow({ appointmentRequired: true }),
        }),
      ],
      lookup,
      FIXED_NOW,
    );
    expect(calls).toBe(0);
    expect(r.options.every((o) => o.status === "no")).toBe(true);
  });
  it("breaks exact score ties deterministically and states selected-destination scope", async () => {
    const input = accessInput();
    const r = await evaluateAccess(
      input,
      [syntheticCandidate("b"), syntheticCandidate("a")],
      journeyLookup({ "-96.0100": [syntheticJourney()] }),
      FIXED_NOW,
    );
    expect(recommendPantry(r, input, search).selectedId).toBe("a");
    const rec = recommendPantry(r, input, { ...search, destinationId: "b" });
    expect(rec.selectedId).toBe("b");
    expect(rec.comparison.scope).toBe("selected-destination");
    expect(rec.explanation.join(" ")).toContain(
      "not a catalog-wide comparison",
    );
  });
});
