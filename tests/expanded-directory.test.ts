import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tx10Pantries } from "../src/data/tx10-pantries";
import { foodResources } from "../src/data/resources";
import { discoverFood } from "../src/lib/simple-food";
import { pointInCoverage } from "../src/lib/district-geometry";
import type { CoverageGeometry } from "../src/lib/coverage-types";
import reviewed from "../data/research/new-tx10-candidates.json";
import additions from "../data/research/fifty-tx10-candidates.json";
import sixtyAdditions from "../data/research/sixty-tx10-candidates.json";
const geometry = JSON.parse(
  readFileSync(
    new URL("../data/geo/tx10-119.geojson", import.meta.url),
    "utf8",
  ),
).features[0].geometry as CoverageGeometry;
it("only admits reviewed regional candidates with an in-district pickup point", () => {
  for (const row of [...reviewed, ...additions, ...sixtyAdditions]) {
    const resource = foodResources.find((r) => r.id === row.id);
    if (row.coverage !== "inside-119th-tx10") continue; // A later review may resolve a previously quarantined record.
    expect(resource, row.id).toBeDefined();
    expect(resource!.coordinates, row.id).not.toBeNull();
    expect(pointInCoverage(resource!.coordinates!, geometry), row.id).toBe(
      true,
    );
    expect(
      discoverFood(foodResources, row.name).matches.some(
        (r) => r.resource.id === row.id,
      ),
      row.id,
    ).toBe(true);
  }
  expect(new Set(foodResources.map((r) => r.id)).size).toBe(
    foodResources.length,
  );
});

it("keeps restricted senior programs and ambiguous recurrence distinct from general pantry access", () => {
  for (const id of [
    "smithville-golden-harvest",
    "smithville-community-garden-csfp",
    "cambridge-villas-csfp",
  ]) {
    const candidate = sixtyAdditions.find((r) => r.id === id)!;
    expect(candidate.eligibility).toContain("over 60");
    expect(candidate.eligibility).toContain("eligibility process");
  }
  for (const id of [
    "cambridge-villas-csfp",
    "new-prairie-view-baptist-san-felipe",
    "colorado-county-mobile-eagle-lake",
    "eagle-lake-food-pantry",
    "hangar-unity-center-brookshire",
    "reveal-resource-center-cedar-park",
  ]) {
    expect(tx10Pantries.find((r) => r.id === id)!.windows, id).toHaveLength(0);
  }
  expect(
    tx10Pantries.find((r) => r.id === "lake-travis-crisis-ministries")!
      .serviceArea,
  ).toContain("Lake Travis ISD");
});
