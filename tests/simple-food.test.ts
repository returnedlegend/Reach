import { describe, expect, it } from "vitest";
import { foodResources, type Resource } from "../src/data/resources";
import {
  discoverFood,
  foodDirectionsUrl,
  localFoodIntent,
} from "../src/lib/simple-food";

const now = new Date("2026-10-26T14:00:00Z");
const point = { lat: 30.650123, lng: -96.350456 };
describe("food discovery without a questionnaire", () => {
  it.each([
    "I don't have a car",
    "I can only walk about half a mile",
    "Find options that don't require an appointment",
    "I need somewhere that's open today",
    "Which location has the most reliable hours?",
  ])(
    "keeps food discovery usable for a preference-only request: %s",
    (text) => {
      expect(discoverFood(foodResources, text).matches.length).toBeGreaterThan(
        0,
      );
    },
  );
  it("shows regional pantries without a location, search, or AI", () => {
    const result = discoverFood(foodResources, "", { now });
    expect(result.matches.length).toBeGreaterThan(2);
    expect(
      result.matches.some((item) =>
        /Bastrop|Giddings|La Grange/i.test(item.resource.address),
      ),
    ).toBe(true);
    expect(
      result.matches.every((item) => item.straightLineMiles === undefined),
    ).toBe(true);
  });
  it.each([
    "I need food in Bryan",
    "Please find groceries near Bryan today",
    "food in College Station",
  ])("understands a common request: %s", (text) => {
    const result = discoverFood(foodResources, text, { now });
    expect(result.matches.length).toBeGreaterThan(0);
    const city = /college station/i.test(text) ? "College Station" : "Bryan";
    expect(
      result.matches.every((item) => item.resource.address.includes(city)),
    ).toBe(true);
  });
  it("finds a named pantry instead of treating the word pantry as a generic request", () => {
    expect(
      discoverFood(foodResources, "Brazos Church Pantry").matches.map(
        (item) => item.resource.id,
      ),
    ).toEqual(["brazos-church-pantry"]);
  });
  it("keeps unsupported geography distinct from explicitly labeled alternatives", () => {
    const result = discoverFood(foodResources, "I need food in Boston");
    expect(result.matches).toEqual([]);
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.notices.join(" ")).toContain(
      "does not mean there is no help",
    );
  });
  it("searches ZIP codes without pretending a ZIP is the user's position", () => {
    const result = discoverFood(foodResources, "food near 77803");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(
      result.matches.every(
        (item) =>
          item.resource.address.includes("77803") ||
          item.resource.postalCode === "77803",
      ),
    ).toBe(true);
    expect(
      result.matches.every((item) => item.straightLineMiles === undefined),
    ).toBe(true);
  });
  it("does not pass groceries off as prepared meals or shelter", () => {
    for (const text of [
      "I need hot meals",
      "I need food but cannot cook",
      "I need shelter",
    ]) {
      const result = discoverFood(foodResources, text);
      expect(result.matches).toHaveLength(0);
      expect(result.alternatives.length).toBeGreaterThan(0);
      expect(result.notices.join(" ")).toMatch(/211/);
    }
  });
  it("does not establish eligibility or accessibility from the request", () => {
    const result = discoverFood(
      foodResources,
      "I need halal food without ID and use a wheelchair",
    );
    expect(result.notices.join(" ")).toContain("cannot confirm");
  });
  it("excludes known no-pedestrian pickup sites from walking and bus options", () => {
    const blocked = {
      ...foodResources[0],
      pedestrianPickup: "not-allowed" as const,
    };
    expect(
      discoverFood([blocked], "food", { origin: point, mode: "walking" })
        .matches,
    ).toHaveLength(0);
    expect(
      discoverFood([blocked], "food", { origin: point, mode: "transit" })
        .matches,
    ).toHaveLength(0);
    expect(
      discoverFood([blocked], "food", { origin: point, mode: "driving" })
        .matches,
    ).toHaveLength(1);
  });
  it("never ranks an unresolved pin ahead of a confirmed site based on proximity", () => {
    const confirmed = {
      ...foodResources[0],
      coordinates: { lat: 30.7, lng: -96.4 },
    };
    const unresolved = {
      ...foodResources[1],
      coordinates: point,
      verificationStatus: "needs-confirmation" as const,
    };
    expect(
      discoverFood([unresolved, confirmed], "food", { origin: point })
        .matches[0].resource.id,
    ).toBe(confirmed.id);
  });
  it("leaves unknown schedules unknown", () => {
    const unknown: Resource = {
      ...foodResources[0],
      windows: [],
      hours: "Hours not verified.",
    };
    const result = discoverFood([unknown], "food", { now });
    expect(result.matches[0].summary.hours).toBe("Hours not verified.");
    expect(result.matches[0].summary.availabilityLabel).toBe(
      "Check before visiting",
    );
  });
  it("does not hide the lack of a confirmed pickup window today behind future options", () => {
    const result = discoverFood(foodResources, "I need food today", {
      now: new Date("2026-10-25T01:00:00Z"),
    });
    expect(result.notices.join(" ")).toContain(
      "confirmed pickup window left today",
    );
    expect(result.matches.length).toBeGreaterThan(0);
  });
});
describe("intent and exact navigation origins", () => {
  it("does not treat a rejected city as a requested search area", () => {
    const boston = discoverFood(
      foodResources,
      "I need food in Boston, not Bryan",
    );
    expect(boston.matches).toHaveLength(0);
    expect(boston.notices.join(" ")).toContain("boston");
    expect(
      boston.alternatives.every((r) => !r.resource.address.includes("Bryan")),
    ).toBe(true);
    const bryan = discoverFood(
      foodResources,
      "food in Bryan, not College Station",
    );
    expect(bryan.matches.length).toBeGreaterThan(0);
    expect(
      bryan.matches.every((r) => r.resource.address.includes("Bryan")),
    ).toBe(true);
  });
  it("does not interpret a negated travel mode as affirmative", () => {
    expect(localFoodIntent("I need food, I cannot walk").mode).toBeUndefined();
    expect(localFoodIntent("I don't take the bus").mode).toBeUndefined();
    expect(localFoodIntent("I don't have a car").mode).toBe("transit");
    expect(localFoodIntent("I am walking").mode).toBe("walking");
    expect(localFoodIntent("I need food, I don't need shelter").service).toBe(
      "food",
    );
    expect(
      discoverFood(foodResources, "I need food, I cannot walk", {
        mode: "walking",
      }).blockedMode,
    ).toBe(true);
    expect(
      discoverFood(foodResources, "I need food, I cannot walk", {
        mode: "driving",
      }).blockedMode,
    ).toBe(false);
  });
  it("carries the actual selected origin and mode into directions", () => {
    const pantry = foodResources.find((r) => r.id === "brazos-church-pantry")!;
    const url = new URL(foodDirectionsUrl(pantry, point, "transit"));
    expect(url.searchParams.get("origin")).toBe("30.650123,-96.350456");
    expect(url.searchParams.get("destination")).toBe(
      `${pantry.coordinates!.lat},${pantry.coordinates!.lng}`,
    );
    expect(url.searchParams.get("travelmode")).toBe("transit");
    expect(
      new URL(foodDirectionsUrl(pantry, undefined, "walking")).searchParams.has(
        "origin",
      ),
    ).toBe(false);
    expect(
      new URL(
        foodDirectionsUrl({ ...pantry, coordinates: null }, point, "walking"),
      ).searchParams.get("origin"),
    ).toBe("30.650123,-96.350456");
  });
});
