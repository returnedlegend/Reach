import { describe, expect, it } from "vitest";
import candidates from "../data/research/tx10-brazos-candidates.json";
import timetable from "../src/data/btd-timetable.json";
import { officialSources, productionData } from "../src/data/coverage";
import { foodResources } from "../src/data/resources";

describe("first public release data review", () => {
  const ids = [
    "bedias-food-pantry",
    "grimes-mobile-pantry",
    "madison-mobile-pantry",
  ];
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );

  it("keeps current source evidence and uncertainty for the three BVFB sites", () => {
    for (const id of ids) {
      const candidate = candidateById.get(id)!;
      const directory = candidate.sources.find((source) =>
        source.url.includes("bvfb.org/find-food"),
      );
      expect(directory?.checkedOn, id).toBe("2026-10-24");
      const resource = foodResources.find((food) => food.id === id)!;
      expect(resource.pedestrianPickup, id).toBe("unknown");
      expect(resource.offering, id).toMatch(/drive-through/i);
      expect(resource.notes, id).toMatch(
        /needs-confirmation|fairground|entrance|pedestrian/i,
      );
    }

    const bedias = candidateById.get("bedias-food-pantry")!;
    expect(bedias.verificationStatus).toBe("needs-confirmation");
    expect(bedias.address).toContain("3202 Main");
    expect(bedias.notes).toContain("3203 Main");
    expect(
      foodResources.find((food) => food.id === "bedias-food-pantry")?.languages,
    ).toContain("Spanish");

    const grimes = candidateById.get("grimes-mobile-pantry")!;
    expect(
      grimes.sources.some((source) =>
        source.url.endsWith("2026%20GMP%20Flyer.pdf"),
      ),
    ).toBe(true);

    const madison = candidateById.get("madison-mobile-pantry")!;
    expect(
      madison.sources.some((source) =>
        source.url.endsWith("2026%20Madison%20Mobile%20Pantry%20Flyers.pdf"),
      ),
    ).toBe(true);
    expect(madison.hours).toMatch(/Nov 19/);
    const madisonResource = foodResources.find(
      (food) => food.id === "madison-mobile-pantry",
    )!;
    expect(madisonResource.windows).toEqual([]);
    expect(madisonResource.notes).toMatch(/third Thursdays/);
  });

  it("exposes pedestrian pickup status in mapped food resources", () => {
    for (const id of ids) {
      expect(
        foodResources.find((food) => food.id === id)?.pedestrianPickup,
      ).toBe("unknown");
    }
  });

  it("documents the BTD table conflict and the snapshot expiry", () => {
    expect(timetable.validTo).toBe("2026-12-31");
    expect(
      officialSources.find((source) => source.id === "btd-web-timetable"),
    ).toMatchObject({
      lastAttempted: "2026-10-24",
      url: "https://www.btd.org/bcs/",
    });
    expect(
      officialSources.find((source) => source.id === "btd")?.status,
    ).toMatch(/March 25, 2026.*October 28, 2025/s);
    expect(productionData.transit.uncertainties?.[0]).toMatch(/:48.*:53/s);
    expect(productionData.transit.uncertainties?.[0]).toMatch(
      /December 31, 2026/,
    );
  });
});
