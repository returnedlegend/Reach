import { describe, expect, it } from "vitest";
import { ACCESS_WEIGHTS, evaluateAccess } from "../src/lib/access-engine";
import { navigationWeights } from "../src/lib/navigation-ranking-agent";
import type { NavigationNeeds } from "../src/lib/navigation-types";
import {
  accessInput, FIXED_NOW, journeyLookup, syntheticCandidate, syntheticJourney, syntheticWindow,
} from "./fixtures/access-scenarios";

const needs = (overrides: Partial<NavigationNeeds> = {}): NavigationNeeds => ({
  service: "food", urgency: "flexible", hasIdentification: "unknown",
  preferTransitNearby: false, ...overrides,
});

describe("declared navigation preferences and ranking", () => {
  it("prioritizes earlier actual service for soon requests while flexible timing favors shorter travel", async () => {
    const candidates = [
      syntheticCandidate("near-late-service", {
        name: "Near, later service", window: syntheticWindow({
          opens: "11:00", closes: "12:00", registrationCutoff: "11:30",
        }),
      }),
      syntheticCandidate("far-early-service", {
        name: "Far, earlier service", coordinates: { lat: 30, lng: -96.02 },
        window: syntheticWindow({ opens: "09:00", closes: "10:00", registrationCutoff: "09:30" }),
      }),
    ];
    const lookup = journeyLookup({
      "-96.0100": [syntheticJourney({ arrival: 490, walkingMinutes: 0, walkingMiles: 0 })],
      "-96.0200": [syntheticJourney({ arrival: 510, walkingMinutes: 0, walkingMiles: 0 })],
    });
    const soon = await evaluateAccess(
      accessInput(), candidates, lookup, FIXED_NOW,
      navigationWeights(needs({ urgency: "soon" }), "walking"),
    );
    const flexible = await evaluateAccess(
      accessInput(), candidates, lookup, FIXED_NOW,
      navigationWeights(needs({ urgency: "flexible" }), "walking"),
    );
    expect(soon.options.map((option) => option.id)).toEqual(["far-early-service", "near-late-service"]);
    expect(flexible.options.map((option) => option.id)).toEqual(["near-late-service", "far-early-service"]);
  });

  it("keeps hard constraint failures below viable choices regardless of urgency weights", async () => {
    const overLimit = syntheticCandidate("over-limit", { name: "Short walk" });
    const viable = syntheticCandidate("viable", { name: "Longer walk", coordinates: { lat: 30, lng: -96.02 } });
    const response = await evaluateAccess(
      accessInput({ maxWalkingMinutes: 5 }), [overLimit, viable], journeyLookup({
        "-96.0100": [syntheticJourney({ arrival: 490, walkingMinutes: 6, walkingMiles: 0.2 })],
        "-96.0200": [syntheticJourney({ arrival: 530, walkingMinutes: 0, walkingMiles: 0 })],
      }), FIXED_NOW,
      navigationWeights(needs({ urgency: "soon" }), "walking"),
    );
    expect(response.options.map((option) => option.id)).toEqual(["viable", "over-limit"]);
    expect(response.options[1].status).toBe("no");
  });

  it("applies the nearby-transit connector and urgency timing preference only to the relevant weights", () => {
    const transit = navigationWeights(needs({ urgency: "today", preferTransitNearby: true }), "transit");
    const walking = navigationWeights(needs({ urgency: "today", preferTransitNearby: true }), "walking");
    const driving = navigationWeights(needs({ urgency: "soon", preferTransitNearby: true }), "driving");
    expect(transit.walkingMinute).toBe(ACCESS_WEIGHTS.walkingMinute + 2);
    expect(walking.walkingMinute).toBe(ACCESS_WEIGHTS.walkingMinute);
    expect(driving.walkingMinute).toBe(ACCESS_WEIGHTS.walkingMinute);
    expect(transit.waitingMinute).toBe(ACCESS_WEIGHTS.waitingMinute);
    expect(driving.waitingMinute).toBe(ACCESS_WEIGHTS.waitingMinute);
    expect(transit.timeToServiceMinute).toBe(ACCESS_WEIGHTS.timeToServiceMinute + 0.5);
    expect(driving.timeToServiceMinute).toBe(ACCESS_WEIGHTS.timeToServiceMinute + 2);
  });
});
