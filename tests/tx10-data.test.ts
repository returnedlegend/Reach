import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foodResources } from "../src/data/resources";
import { realPantries } from "../src/data/real-pantries";
import type { CoverageGeometry } from "../src/lib/coverage-types";
import { pointInCoverage } from "../src/lib/district-geometry";

const geometryPath = fileURLToPath(
  new URL("../data/geo/tx10-119.geojson", import.meta.url),
);
const geometry = JSON.parse(readFileSync(geometryPath, "utf8")).features[0]
  .geometry as CoverageGeometry;
const admittedIds = [
  "smithville-food-pantry",
  "bellville-christian-food-pantry",
  "columbus-food-pantry",
  "flatonia-area-food-pantry",
  "anderson-food-pantry",
  "bedias-food-pantry",
  "christian-community-services-navasota",
  "elizabeth-lutheran-caldwell",
  "in-gods-hands-caldwell",
  "grimes-mobile-pantry",
  "madison-mobile-pantry",
  "prairie-hill-food-pantry",
  "faith-mission-brenham",
  "caldwell-christians-care",
  "lee-chapel-united-methodist-bryan",
  "new-zion-food-pantry-bryan",
  "bastrop-county-emergency-food-pantry",
  "giddings-area-care-center-food-pantry",
  "amen-la-grange",
  "schulenburg-area-food-pantry",
];

describe("TX-10 pantry admissions", () => {
  it("keeps Elgin's ambiguous N/S map pin unknown while preserving official pickup information", () => {
    const site = foodResources.find(
      (r) => r.id === "elgin-community-cupboard",
    )!;
    expect(site.coordinates).toBeNull();
    expect(site.address).toContain("303 Avenue C");
    expect(site.notes).toMatch(/ambig|two/i);
    expect(
      site.sources.some((s) => s.url === "https://elgincommunitycupboard.org/"),
    ).toBe(true);
  });

  it("keeps only pinned pickup points inside the official 119th Congress geometry", () => {
    const newRecords = realPantries.filter((p) => admittedIds.includes(p.id));
    expect(newRecords.map((p) => p.id).sort()).toEqual([...admittedIds].sort());
    for (const record of newRecords) {
      expect(record.coordinates, record.id).not.toBeNull();
      expect(
        pointInCoverage(
          { lat: record.coordinates!.lat, lng: record.coordinates!.lon },
          geometry,
        ),
        record.id,
      ).toBe(true);
    }
    const excluded = [
      "progressive-missionary-baptist-hearne",
      "robertson-county-cares-franklin",
      "call-for-help-hearne",
      "washington-mobile-pantry-brenham",
    ];
    for (const id of excluded)
      expect(
        realPantries.some((p) => p.id === id),
        id,
      ).toBe(false);
  });

  it("retains source dates, address metadata and honest schedule uncertainty", () => {
    expect(foodResources).toHaveLength(29);
    for (const id of admittedIds) {
      const resource = foodResources.find((p) => p.id === id)!;
      expect(resource.sources.length, id).toBeGreaterThan(0);
      const auditedOnOctober24 = [
        "bedias-food-pantry",
        "grimes-mobile-pantry",
        "madison-mobile-pantry",
      ].includes(id);
      expect(
        resource.sources.every(
          (source) =>
            source.url?.startsWith("https://") &&
            (auditedOnOctober24
              ? ["2026-10-21", "2026-10-24"].includes(source.checkedOn ?? "")
              : /^2026-10-2[125]$/.test(source.checkedOn ?? "")),
        ),
        id,
      ).toBe(true);
      if (auditedOnOctober24) {
        expect(
          resource.sources.find((source) =>
            source.url?.includes("bvfb.org/find-food"),
          )?.checkedOn,
          id,
        ).toBe("2026-10-24");
      }
      expect(resource.city, id).toBeTruthy();
      expect(resource.coordinates).not.toBeNull();
    }
    const bastropResource = foodResources.find(
      (p) => p.id === "bastrop-county-emergency-food-pantry",
    )!;
    expect(bastropResource.website).toBe("https://bastropfoodpantry.org/");
    expect(bastropResource.city).toBe("Bastrop");
    expect(bastropResource.postalCode).toBe("78602");
    expect(
      foodResources
        .find((p) => p.id === "giddings-area-care-center-food-pantry")
        ?.sources.some((source) =>
          source.url?.includes(
            "geocoding.geo.census.gov/geocoder/locations/onelineaddress",
          ),
        ),
    ).toBe(true);
    const giddings = foodResources.find(
      (p) => p.id === "giddings-area-care-center-food-pantry",
    )!;
    expect(giddings.windows).toEqual([]);
    for (const id of ["amen-la-grange", "schulenburg-area-food-pantry"]) {
      const pantry = realPantries.find((p) => p.id === id)!;
      expect(pantry.windows.length, id).toBeGreaterThan(0);
      expect(
        pantry.windows.every(
          (w) => w.appointmentRequired === undefined && !w.policyKnown,
        ),
        id,
      ).toBe(true);
      expect(
        foodResources
          .find((p) => p.id === id)
          ?.sources.some((source) =>
            source.url?.includes(
              "geocoding.geo.census.gov/geocoder/locations/onelineaddress",
            ),
          ),
        id,
      ).toBe(true);
    }
    const madison = foodResources.find(
      (p) => p.id === "madison-mobile-pantry",
    )!;
    expect(madison.windows).toEqual([]);
    expect(madison.hours).toMatch(/Nov 19/);
    expect(madison.notes).toMatch(/third Thursdays/);
    const bastrop = realPantries.find(
      (p) => p.id === "bastrop-county-emergency-food-pantry",
    )!;
    expect(bastrop.windows.some((w) => w.appointmentRequired)).toBe(true);
    expect(bastrop.windows.some((w) => w.rule.kind === "nth-weekday")).toBe(
      true,
    );
    const bvfbPantry = realPantries.find(
      (p) => p.id === "anderson-food-pantry",
    )!;
    expect(bvfbPantry.windows[0].appointmentRequired).toBeUndefined();
    expect(bvfbPantry.windows[0].policyKnown).toBe(false);
    const bastropMarket = bastrop.windows.find((w) =>
      w.id.includes("community-market"),
    )!;
    expect(bastropMarket.appointmentRequired).toBe(false);
    expect(bastropMarket.policyKnown).toBe(true);
    expect(bvfbPantry.serviceArea).toBe("All counties");
    expect(bastrop.serviceArea).toBeUndefined();
  });
});
