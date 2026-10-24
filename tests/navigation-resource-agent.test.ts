import { describe, expect, it } from "vitest";
import type { AccessCandidate } from "../src/lib/access-engine";
import type { BusySummary } from "../src/lib/crowd-types";
import {
  inspectNavigationResources,
  navigationCrowdNote,
  navigationNeedsSchema,
} from "../src/lib/navigation-resource-agent";
import { DEFAULT_NAVIGATION_NEEDS } from "../src/lib/navigation-types";

const now = new Date("2026-10-23T12:00:00.000Z");

/** Synthetic candidates only; never used as production data. */
function syntheticCandidate(
  id: string,
  kind: "pantry" | "household" = "pantry",
): AccessCandidate {
  const source = {
    id: `source-${id}`,
    title: "Synthetic fixture source",
    checkedOn: "2026-10-01",
  };
  return {
    kind,
    resource: {
      id,
      name: `Synthetic ${kind} ${id}`,
      address: "Synthetic fixture address",
      coordinates: { lat: 30.65, lng: -96.35 },
      hours: "Synthetic hours",
      eligibility: "Synthetic conditions",
      notes: "Synthetic fixture; not a real service",
      sources: [{ title: source.title, checkedOn: source.checkedOn }],
    },
    pantry: {
      id,
      name: `Synthetic ${kind} ${id}`,
      address: "Synthetic fixture address",
      windows: [],
      walkConnections: [],
      directWalks: [],
      sources: [source],
    },
    availability: {
      status: "unknown",
      source: "Synthetic fixture",
      reportedAt: null,
      expiresAt: null,
    },
  };
}

/** Synthetic crowd summary only; not a production observation. */
function syntheticCrowdSummary(): BusySummary {
  return {
    pantryId: "synthetic-pantry",
    timeZone: "America/Chicago",
    days: [
      {
        weekday: 2,
        label: "Tuesday",
        hours: [
          {
            hour: 11,
            level: null,
            waitMinutes: null,
            status: "insufficient",
            confidence: null,
          },
          {
            hour: 12,
            level: 1,
            waitMinutes: 8,
            status: "observed",
            confidence: "medium",
          },
        ],
      },
      {
        weekday: 3,
        label: "Wednesday",
        hours: [
          {
            hour: 12,
            level: 3,
            waitMinutes: 2,
            status: "observed",
            confidence: "high",
          },
        ],
      },
    ],
    hourly: [],
    recent: {
      level: 3,
      waitMinutes: 0,
      updatedAt: "2026-10-23T12:00:00.000Z",
      status: "community observations",
    },
    quieterWindow: null,
    method: "Synthetic fixture method",
    explanation: "Synthetic fixture; not a real observation.",
  };
}

describe("navigation needs schema and resource limitations", () => {
  it("defaults declared needs strictly and rejects unknown fields or invalid household size", () => {
    expect(navigationNeedsSchema.parse({})).toEqual(DEFAULT_NAVIGATION_NEEDS);
    expect(navigationNeedsSchema.parse({ householdSize: 4 })).toEqual({
      ...DEFAULT_NAVIGATION_NEEDS,
      householdSize: 4,
    });
    expect(
      navigationNeedsSchema.safeParse({ service: "shelter", extra: true })
        .success,
    ).toBe(false);
    expect(navigationNeedsSchema.safeParse({ householdSize: 0 }).success).toBe(
      false,
    );
  });

  it("does not infer unavailable shelter or prepared-meal services from food candidates", () => {
    const candidates = [syntheticCandidate("synthetic-pantry")];
    for (const service of ["shelter", "prepared-meals"] as const) {
      const result = inspectNavigationResources(
        candidates,
        { ...DEFAULT_NAVIGATION_NEEDS, service },
        now,
      );
      expect(result.candidates).toEqual([]);
      expect(result.limitations[0]).toMatch(/No verified/);
    }
  });

  it("keeps actual grocery candidates, marks household food and quantity unknown, and preserves source facts", () => {
    const pantry = syntheticCandidate("synthetic-grocery");
    const household = syntheticCandidate("synthetic-household", "household");
    const originals = structuredClone([pantry, household]);
    const result = inspectNavigationResources(
      [pantry, household],
      {
        ...DEFAULT_NAVIGATION_NEEDS,
        service: "groceries",
        householdSize: 5,
        preferTransitNearby: true,
      },
      now,
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].navigationWarnings).toContain(
      "Quantity for the declared household size is not verified.",
    );
    expect(result.candidates[1].navigationWarnings).toContain(
      "Household food type and grocery suitability are unverified.",
    );
    expect(result.limitations.join(" ")).toMatch(/untyped or unverified/);
    expect(result.limitations.join(" ")).toMatch(
      /computed transit route options/,
    );
    expect(
      result.candidates.map(
        ({ kind: _kind, resource, pantry: p, availability }) => ({
          resource,
          pantry: p,
          availability,
        }),
      ),
    ).toEqual(
      originals.map(({ kind: _kind, resource, pantry: p, availability }) => ({
        resource,
        pantry: p,
        availability,
      })),
    );
  });

  it("flags stale, invalid, and missing source dates and asks about ID without treating it as a hard failure", () => {
    const candidates = [
      syntheticCandidate("synthetic-stale"),
      syntheticCandidate("synthetic-invalid"),
      syntheticCandidate("synthetic-missing"),
    ];
    candidates[0].resource.sources[0].checkedOn = "2026-01-01";
    candidates[1].resource.sources[0].checkedOn = "2026-02-30";
    candidates[2].resource.sources[0].checkedOn = undefined;
    const result = inspectNavigationResources(
      candidates,
      { ...DEFAULT_NAVIGATION_NEEDS, hasIdentification: "no" },
      now,
    );

    expect(result.candidates).toHaveLength(3);
    for (const candidate of result.candidates) {
      expect(
        candidate.navigationWarnings?.some((warning) =>
          warning.includes("source records"),
        ),
      ).toBe(true);
      expect(
        candidate.navigationWarnings?.some((warning) =>
          warning.includes("Confirm document policy"),
        ),
      ).toBe(true);
    }
  });

  it("does not treat missing or insufficient historical crowd slots as no crowding", () => {
    const summary = syntheticCrowdSummary();
    const unsupported =
      "No sufficiently supported crowd pattern is available for the planned pickup hour.";
    expect(navigationCrowdNote(null, 2, 12)).toBe(unsupported);
    expect(navigationCrowdNote(summary, 2, 11)).toBe(unsupported);
    expect(navigationCrowdNote(summary, 4, 12)).toBe(unsupported);
  });

  it("uses only the matching weekday and hour and labels any wait as historical", () => {
    const note = navigationCrowdNote(syntheticCrowdSummary(), 2, 12);
    expect(note).toContain(
      "Historical community observations describe little crowding",
    );
    expect(note).toContain("medium confidence");
    expect(note).toContain("historical average reported wait was 8 minutes");
    expect(note).toContain("not a live queue or predicted wait");
    expect(note).not.toContain("verybusy");
  });
});
