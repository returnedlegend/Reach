import { describe, expect, it } from "vitest";
import { evaluateAccess } from "../src/lib/access-engine";
import { chicagoWallInstant } from "../src/lib/access-time";
import {
  accessInput,
  FIXED_NOW,
  syntheticCandidate,
  syntheticJourney,
} from "./fixtures/access-scenarios";

describe("independent release checks for pantry recommendations", () => {
  it("converts ordinary Chicago wall times across seasons and refuses DST gaps and folds", () => {
    expect(chicagoWallInstant("2026-01-15", "08:00")?.toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
    expect(chicagoWallInstant("2026-07-15", "08:00")?.toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
    expect(chicagoWallInstant("2026-03-08", "02:30")).toBeNull();
    expect(chicagoWallInstant("2026-11-01", "01:30")).toBeNull();
  });

  it("does not accept a return itinerary that departs before the visit ends", async () => {
    const candidate = syntheticCandidate("return-too-early", {
      coordinates: { lat: 30, lng: -96.01 },
    });
    const response = await evaluateAccess(
      accessInput({
        returnTo: { lat: 30, lng: -96.03 },
        returnDeadline: "12:00",
      }),
      [candidate],
      async (from, to, earliest) => {
        if (to.lng === -96.01) return [syntheticJourney({ arrival: 510 })];
        expect(from.lng).toBe(-96.01);
        expect(earliest).toBe(560); // Service is modeled as 09:00–09:20.
        return [syntheticJourney({ departure: 545, arrival: 575 })];
      },
      FIXED_NOW,
    );

    expect(response.options[0].status).not.toBe("fits");
    expect(response.options[0].returnJourney).toBeNull();
  });

  it("does not accept an outbound itinerary that starts before the requested departure", async () => {
    const response = await evaluateAccess(
      accessInput(),
      [syntheticCandidate("outbound-too-early")],
      async (_from, _to, earliest) => {
        expect(earliest).toBe(480);
        return [syntheticJourney({ departure: 470, arrival: 510 })];
      },
      FIXED_NOW,
    );

    expect(response.options[0].status).toBe("no");
    expect(response.options[0].reasons.join(" ")).toMatch(
      /outside the requested travel window/i,
    );
  });

  it.each([
    {
      name: "walking time",
      input: { maxWalkingMinutes: 10 },
      leg: { walkingMinutes: 6, walkingMiles: 0.2, fare: 0 },
    },
    {
      name: "fare",
      input: { fareBudget: 2 },
      leg: { walkingMinutes: 1, walkingMiles: 0.05, fare: 1.25 },
    },
  ])(
    "applies the $name limit across both trip legs",
    async ({ input, leg }) => {
      const candidate = syntheticCandidate(
        `round-trip-${input.maxWalkingMinutes ?? input.fareBudget}`,
        {
          coordinates: { lat: 30, lng: -96.01 },
        },
      );
      const response = await evaluateAccess(
        accessInput({
          maxWalkingMinutes: 60,
          fareBudget: 20,
          returnTo: { lat: 30, lng: -96.03 },
          returnDeadline: "12:00",
          ...input,
        }),
        [candidate],
        async (_from, to) =>
          to.lng === -96.01
            ? [syntheticJourney(leg)]
            : [syntheticJourney({ ...leg, departure: 560, arrival: 590 })],
        FIXED_NOW,
      );

      expect(response.options[0].status).toBe("no");
      expect(response.options[0].reasons.join(" ")).toMatch(
        input.maxWalkingMinutes ? /walking-time limit/i : /fare budget/i,
      );
    },
  );
});
