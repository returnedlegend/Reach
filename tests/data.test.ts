import { describe, expect, it } from "vitest";
import { demoData, demoDefaults } from "../src/data/demo";
import { productionData } from "../src/data/coverage";
import { validateData } from "../src/lib/data-validation";
import { planVisits } from "../src/lib/planner";

describe("reviewed data fixtures", () => {
  it("accepts fictional fixtures and real source-reviewed coverage", () => {
    expect(validateData(demoData)).toEqual([]);
    expect(validateData(productionData)).toEqual([]);
    expect(productionData.pantries).toHaveLength(24);
  });
  it("includes fits, confirm and no outcomes for the default scenario", () => {
    const statuses = planVisits(demoDefaults, demoData).map((r) => r.status);
    expect(statuses).toContain("fits");
    expect(statuses).toContain("confirm");
    expect(statuses).toContain("no");
  });
  it("rejects missing real source provenance", () => {
    const data = structuredClone(demoData);
    data.pantries[0].sources[0] = {
      id: data.pantries[0].sources[0].id,
      title: "Unsupported provider claim",
    };
    expect(
      validateData(data).some((e) => e.includes("verificationMethod")),
    ).toBe(true);
  });
  it("rejects broken network references, unreviewed walks and reversed stop times", () => {
    const data = structuredClone(demoData);
    data.origins[0].walkConnections[0].reviewed = false;
    data.transit.trips[0].serviceId = "missing";
    data.transit.trips[0].stops[1].arrival = "07:00";
    const errors = validateData(data);
    expect(errors.some((e) => e.includes("requires review"))).toBe(true);
    expect(errors.some((e) => e.includes("missing service"))).toBe(true);
    expect(errors.some((e) => e.includes("chronological"))).toBe(true);
  });
  it("rejects invalid coordinates and dates", () => {
    const data = structuredClone(demoData);
    data.pantries[0].coordinates = { lat: NaN, lon: 200 };
    data.transit.validFrom = "2026-02-30";
    const errors = validateData(data);
    expect(errors.some((e) => e.includes("coordinates"))).toBe(true);
    expect(errors.some((e) => e.includes("invalid date"))).toBe(true);
  });
});
