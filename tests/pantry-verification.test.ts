import { describe, expect, it } from "vitest";
import { realPantries } from "../src/data/real-pantries";
import { pantryVerification } from "../src/data/pantry-verification";
import { foodResources, resourceFromPantry } from "../src/data/resources";
describe("maintained pantry evidence", () => {
  it("covers each production listing once, with dated source evidence and no office-only additions", () => {
    expect(Object.keys(pantryVerification).sort()).toEqual(
      realPantries.map((p) => p.id).sort(),
    );
    expect(new Set(foodResources.map((p) => p.id)).size).toBe(66);
    for (const p of foodResources) {
      expect(
        p.sources.every(
          (s) => Boolean(s.checkedOn && s.url?.startsWith("https://")),
        ),
      ).toBe(true);
      if (p.id === "elgin-community-cupboard") expect(p.coordinates).toBeNull();
      else {
        expect(Number.isFinite(p.coordinates?.lat)).toBe(true);
        expect(Number.isFinite(p.coordinates?.lng)).toBe(true);
      }
      expect(p.offering).toMatch(/distribution|goods|shopping|food pantry|food pickup|food assistance/i);
      expect(p.hours).not.toMatch(/open now/i);
    }
  });
  it("retains uncertainty when a new listing lacks reviewed evidence, without reusing a guessed pin", () => {
    const sourceOnly = resourceFromPantry(realPantries[0]);
    expect(sourceOnly.coordinates).toBeNull();
    expect(sourceOnly.verificationStatus).toBe("needs-confirmation");
    expect(sourceOnly.hours).toBe("Distribution hours not verified.");
    expect(sourceOnly.eligibility).toBe("Eligibility not verified.");
    expect(sourceOnly.accessibility).toBe("Accessibility not verified.");
  });
  it("uses independently sourced provider addresses and coordinate evidence in both interfaces", () => {
    const salvation = foodResources.find(
      (p) => p.id === "salvation-army-bryan",
    )!;
    expect(salvation.address).toMatch(/2506 Cavitt Ave/);
    expect(salvation.coordinates).toEqual({ lat: 30.64562, lng: -96.36042 });
    expect(
      realPantries.find((p) => p.id === salvation.id)?.coordinates,
    ).toEqual({ lat: 30.64562, lon: -96.36042 });
    expect(
      foodResources.find((p) => p.id === "first-baptist-college-station")
        ?.address,
    ).toContain("77845");
  });
  it("does not conceal conflicting opening times or silently claim a safe pedestrian entrance", () => {
    const umc = foodResources.find((p) => p.id === "first-united-methodist")!;
    expect(umc.detailsNeedConfirmation).toBe(true);
    expect(umc.hours).toMatch(/10:30/);
    expect(umc.hours).toMatch(/11:30/);
    expect(
      realPantries
        .find((p) => p.id === umc.id)
        ?.windows.every((w) => w.conflictingSources),
    ).toBe(true);
    expect(
      foodResources.every((p) => p.notes.match(/entrance|walk|pedestrian/i)),
    ).toBe(true);
  });
});
