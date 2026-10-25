import type { AccessOption, AccessResponse } from "../../src/lib/access-types";
import { foodResources } from "../../src/data/resources";

/** Synthetic itinerary for UI/time tests. Not an actual route, schedule, or stock report. */
export function foodCheckFixture(
  mode: "walking" | "transit" | "driving" = "walking",
): AccessResponse & { planningDate: string; assumptions: string[] } {
  const resource = foodResources.find((r) => r.id === "brazos-church-pantry")!;
  const option: AccessOption = {
    id: resource.id,
    kind: "pantry",
    resource,
    status: "confirm",
    reasons: ["Synthetic fixture: the modeled visit fits a recorded window."],
    warnings: [
      "Appointment arrangements need confirmation.",
      "Step-free access and pedestrian pickup have not been verified.",
    ],
    labels: ["Synthetic fixture"],
    availability: {
      status: "unknown",
      source: "Synthetic unknown report",
      reportedAt: null,
      expiresAt: null,
    },
    outbound: {
      mode,
      departure: 631,
      arrival: 637,
      distanceMiles: 0.3,
      durationMinutes: 6,
      walkingMiles: 0.3,
      walkingMinutes: 6,
      transfers: 0,
      fare: null,
      source: mode === "transit" ? "scheduled" : "routed",
      steps: ["Synthetic outbound instruction"],
      paths: [
        {
          id: "synthetic",
          mode: "walking",
          label: "Synthetic walking path",
          coordinates: [
            [-96.376, 30.675],
            [-96.3757, 30.674241],
          ],
        },
      ],
      attribution: [],
      warnings: [],
    },
    returnJourney: {
      mode,
      departure: 810,
      arrival: 816,
      distanceMiles: 0.3,
      durationMinutes: 6,
      walkingMiles: 0.3,
      walkingMinutes: 6,
      transfers: 0,
      fare: null,
      source: mode === "transit" ? "scheduled" : "routed",
      steps: ["Synthetic return instruction"],
      paths: [],
      attribution: [],
      warnings: [],
    },
    serviceStart: 780,
    serviceEnd: 810,
    intakeCutoff: 840,
    score: 1,
  };
  return {
    timezone: "America/Chicago",
    searchedAt: "2026-10-26T15:30:00Z",
    planningDate: "2026-10-26",
    options: [option],
    routingCalls: 2,
    aiCalls: 0,
    message: "Synthetic fixture, not a live integration",
    assumptions: ["Synthetic 30-minute visit and same-point return"],
    recommendation: {
      algorithm: "feasibility-weighted-v1",
      status: "confirm",
      selectedId: resource.id,
      alternativeIds: [],
      paretoFrontierIds: [resource.id],
      headline: "Synthetic checked trip",
      explanation: [
        "Synthetic fixture: routed outbound and return were supplied.",
      ],
      comparison: {
        scope: "catalog",
        totalPantries: 1,
        verifiedPantries: 1,
        routedPantries: 1,
        staticallyExcludedPantries: 0,
        unresolvedPantries: 0,
        unverifiedPantries: 0,
        siteLimit: 8,
        routeLimitReached: false,
        complete: true,
      },
    },
  };
}
