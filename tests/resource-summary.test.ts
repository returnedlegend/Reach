import { describe, expect, it } from "vitest";
import { foodResources } from "../src/data/resources";
import type { Resource } from "../src/data/resources";
import {
  rankResources,
  summarizeResource,
  verifiedFacts,
} from "../src/lib/resource-summary";

const baseResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: "sample",
  name: "Sample Pantry",
  address: "10 Main St, Bryan, TX",
  coordinates: null,
  hours: "Distribution hours not verified.",
  eligibility: "Eligibility not verified.",
  notes: "",
  sources: [],
  verificationStatus: "needs-confirmation",
  ...overrides,
});

describe("resource summaries", () => {
  it("keeps missing hours and date-unknown availability explicitly uncertain", () => {
    const summary = summarizeResource(baseResource(), undefined);
    expect(summary.hours).toBe("Distribution hours not verified.");
    expect(summary.availabilityLabel).toBe("Check before visiting");
    expect(summary.statusLabel).toBe("Needs confirmation");
    expect(verifiedFacts(baseResource())).not.toHaveProperty(
      "availabilityLabel",
    );
  });

  it("preserves conflicting published hours and never calls an evening visit open", () => {
    const resource = foodResources.find(
      (item) => item.id === "first-united-methodist",
    )!;
    const summary = summarizeResource(
      resource,
      new Date("2026-11-07T18:00:00.000Z"),
    );
    expect(summary.hours).toContain("10:30am");
    expect(summary.hours).toContain("11:30am");
    expect(summary.availabilityLabel).toBe("Check before visiting");
    expect(summary.statusLabel).toMatch(/details need confirmation/i);
  });

  it("matches recurrence in Chicago time across DST and suppresses prose-only closure caveats", () => {
    const parkway = foodResources.find(
      (item) => item.id === "parkway-baptist",
    )!;
    // Nov 21, 2026 is the third Saturday, after Chicago has switched to CST.
    const daylightStandardTimeWindow = summarizeResource(
      parkway,
      new Date("2026-11-21T16:30:00.000Z"),
    );
    expect(daylightStandardTimeWindow.availabilityLabel).toBe(
      "Published distribution window",
    );

    const hopeful = foodResources.find(
      (item) => item.id === "a-hopeful-harvest",
    )!;
    // The listing mentions programmed closures in prose, so no recurrence date
    // is treated as a published window until those exceptions are structured.
    const closure = summarizeResource(
      hopeful,
      new Date("2026-10-31T20:00:00.000Z"),
    );
    expect(closure.availabilityLabel).toBe("Check before visiting");
  });

  it("suppresses a published window for an explicitly structured closure date", () => {
    const parkway = foodResources.find(
      (item) => item.id === "parkway-baptist",
    )!;
    const updatedRecord = { ...parkway, closures: ["2026-11-21"] };
    expect(
      summarizeResource(updatedRecord, new Date("2026-11-21T16:30:00.000Z"))
        .availabilityLabel,
    ).toBe("Check before visiting");
    expect(
      summarizeResource(parkway, new Date("2026-11-21T16:30:00.000Z"))
        .availabilityLabel,
    ).toBe("Published distribution window");
  });

  it("ranks confirmed sites ahead of a closer unconfirmed site and reports straight-line miles", () => {
    const confirmed = baseResource({
      id: "confirmed",
      name: "Confirmed farther away",
      coordinates: { lat: 30.7, lng: -96.3 },
      verificationStatus: "confirmed-site",
    });
    const unconfirmed = baseResource({
      id: "unconfirmed",
      name: "Unconfirmed nearby",
      coordinates: { lat: 30.001, lng: -96 },
      verificationStatus: "needs-confirmation",
    });
    const ranked = rankResources([unconfirmed, confirmed], {
      origin: { lat: 30, lng: -96 },
      mode: "walking",
    });
    expect(ranked.map((item) => item.resource.id)).toEqual([
      "confirmed",
      "unconfirmed",
    ]);
    expect(ranked[0].straightLineMiles).toBeGreaterThan(1);
    expect(ranked[1].straightLineMiles).toBeLessThan(1);
    expect(ranked[0]).not.toHaveProperty("walkingMiles");
  });

  it("does not substitute a city center for missing coordinates", () => {
    const unknown = baseResource({ coordinates: null });
    expect(
      rankResources([unknown], { origin: { lat: 30.6, lng: -96.3 } })[0],
    ).not.toHaveProperty("straightLineMiles");
    expect(rankResources([unknown], { origin: null })[0]).not.toHaveProperty(
      "straightLineMiles",
    );
  });

  it("applies a distance limit only to resources with known coordinates", () => {
    const unknown = baseResource({ id: "unknown", coordinates: null });
    const outside = baseResource({
      id: "outside",
      coordinates: { lat: 30.1, lng: -96 },
      verificationStatus: "confirmed-site",
    });
    const ranked = rankResources([unknown, outside], {
      origin: { lat: 30, lng: -96 },
      maxDistanceMiles: 1,
    });
    expect(ranked).toEqual([]);
  });

  it("ranks a matching published window ahead of a nearer site in the same confirmation tier", () => {
    const parkway = foodResources.find(
      (item) => item.id === "parkway-baptist",
    )!;
    const nearer = baseResource({
      id: "nearer-unconfirmed",
      coordinates: { lat: 30.603, lng: -96.313 },
      verificationStatus: "confirmed-site",
    });
    const ranked = rankResources([nearer, parkway], {
      origin: { lat: 30.603, lng: -96.313 },
      now: new Date("2026-11-21T16:30:00.000Z"),
    });
    expect(ranked.map((item) => item.resource.id)).toEqual([
      "parkway-baptist",
      "nearer-unconfirmed",
    ]);
  });
});
