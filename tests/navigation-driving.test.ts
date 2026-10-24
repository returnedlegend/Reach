import { describe, expect, it } from "vitest";
import { accessJourneyLookup } from "../src/lib/access-routing";
import { evaluateAccess } from "../src/lib/access-engine";
import type { JourneyResult } from "../src/lib/osm-services";
import {
  accessInput, FIXED_NOW, journeyLookup, syntheticCandidate,
} from "./fixtures/access-scenarios";

const routeResult = (distanceMiles = 7.25, durationMinutes = 18.2): JourneyResult => ({
  status: "available", distanceMiles, durationMinutes, label: "Synthetic drive",
  steps: [{ instruction: "Synthetic route instruction" }], paths: [], attribution: [],
});

describe("driving access journeys (synthetic routes only)", () => {
  it("routes outbound and return with exact endpoints and preserves unknown driving costs", async () => {
    const origin = { lat: 30, lng: -96 }, destination = { lat: 30.1, lng: -96.2 }, home = { lat: 30.2, lng: -96.3 };
    const calls: Array<{ origin: unknown; destination: unknown; mode: string }> = [];
    const route = async (request: { origin: unknown; destination: unknown; mode: string }) => {
      calls.push(request);
      return routeResult();
    };
    const input = accessInput({ mode: "driving", origin, returnTo: home, returnDeadline: "12:00" });
    const lookup = accessJourneyLookup(input, { route: route as never });
    const outbound = await lookup.lookup(origin, destination, 480, 720);
    const returned = await lookup.lookup(destination, home, 570, 720);

    expect(calls).toEqual([
      { origin, destination, mode: "driving" },
      { origin: destination, destination: home, mode: "driving" },
    ]);
    expect(outbound[0]).toMatchObject({
      mode: "driving", distanceMiles: 7.25, durationMinutes: 19,
      walkingMinutes: 0, walkingMiles: 0, fare: null,
    });
    expect(returned[0]?.fare).toBeNull();

    const candidate = syntheticCandidate("drive", { coordinates: destination, pedestrianPickup: "not-allowed" });
    const response = await evaluateAccess(input, [candidate], journeyLookup({
      [destination.lng.toFixed(4)]: [outbound[0]], [home.lng.toFixed(4)]: [returned[0]],
    }), FIXED_NOW);
    const option = response.options[0];
    expect(option.status).toBe("confirm");
    expect(option.outbound?.distanceMiles).toBe(7.25);
    expect(option.returnJourney?.fare).toBeNull();
    expect(option.labels).not.toContain("No travel fare");
    expect(option.warnings.join(" ")).toMatch(/fuel, parking.*unknown/i);
    expect(option.reasons.join(" ")).not.toMatch(/pedestrian pickup/i);
  });

  it("does not invent a route or distance when routing fails, while pedestrian bans still block walking", async () => {
    const input = accessInput({ mode: "driving" });
    const failed = accessJourneyLookup(input, {
      route: async () => ({ status: "unavailable", reason: "no-route", message: "Synthetic route unavailable" }),
    });
    const candidate = syntheticCandidate("no-drive-route", { pedestrianPickup: "not-allowed" });
    const driving = await evaluateAccess(input, [candidate], failed.lookup, FIXED_NOW);
    expect(driving.options[0].status).toBe("confirm");
    expect(driving.options[0].outbound).toBeNull();
    expect(driving.options[0].reasons.join(" ")).toMatch(/no verified itinerary/i);

    const walkingCandidate = syntheticCandidate("walk-ban", { pedestrianPickup: "not-allowed" });
    const walking = await evaluateAccess(accessInput({ mode: "walking" }), [walkingCandidate], journeyLookup({
      "-96.0100": [],
    }), FIXED_NOW);
    expect(walking.options[0].status).toBe("no");
    expect(walking.options[0].reasons.join(" ")).toMatch(/does not allow pedestrian pickup/i);
    expect(walking.options[0].outbound).toBeNull();
  });
});
