import { describe, expect, it } from "vitest";
import { demoData, demoDefaults } from "../src/data/demo";
import { planVisits } from "../src/lib/planner";
import { isSavedPlan } from "../src/lib/saved-plan-validation";
import { tripCard, type SavedPlan } from "../src/lib/trip-card";
const result = planVisits(demoDefaults, demoData)[0];
const plan: SavedPlan = {
  id: "test",
  savedAt: "2026-10-15T23:00:00.000Z",
  demo: true,
  input: demoDefaults,
  result,
  pantry: demoData.pantries[0],
  originName: demoData.origins[0].name,
  placeNames: Object.fromEntries(
    [...demoData.origins, ...demoData.pantries, ...demoData.transit.stops].map(
      (p) => [p.id, p.name],
    ),
  ),
};
describe("saved trip snapshots", () => {
  it("accepts a genuine computed snapshot and uses readable place names on the downloaded card", () => {
    expect(isSavedPlan(plan)).toBe(true);
    const card = tripCard(plan);
    expect(card).toContain("FICTIONAL EXAMPLE — DO NOT USE FOR TRAVEL");
    expect(card).toContain("Sample neighborhood stop");
    expect(card).not.toContain("sample-home-stop");
  });
  it("rejects corrupt date, nested itinerary, phone, and unsafe source URLs before rendering", () => {
    expect(isSavedPlan(null)).toBe(false);
    expect(
      isSavedPlan({ ...plan, input: { ...plan.input, date: "2026-02-30" } }),
    ).toBe(false);
    expect(
      isSavedPlan({ ...plan, result: { ...result, segments: [null] } }),
    ).toBe(false);
    expect(
      isSavedPlan({ ...plan, pantry: { ...plan.pantry, phone: 123 } }),
    ).toBe(false);
    expect(
      isSavedPlan({
        ...plan,
        result: {
          ...result,
          sources: [{ id: "bad", title: "bad", url: "javascript:alert(1)" }],
        },
      }),
    ).toBe(false);
  });
});
