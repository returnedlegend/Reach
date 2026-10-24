import { describe, expect, it } from "vitest";
import { parseSavedItems, savedTripText } from "../src/lib/saved-items";

describe("device saved trip boundary", () => {
  it("keeps bookmarks free of coordinates and ignores injected fields", () => {
    const parsed = parseSavedItems(
      JSON.stringify({
        version: 1,
        resourceIds: ["bridge"],
        trips: [],
        origin: { lat: 30.65, lng: -96.35 },
        token: "not-persisted",
      }),
    );
    expect(parsed).toEqual({ version: 1, resourceIds: ["bridge"], trips: [] });
  });
  it("rejects corrupt, excessive or prototype-bearing data", () => {
    for (const raw of [
      "not json",
      "x".repeat(200001),
      '{"version":1,"resourceIds":[],"trips":[],"__proto__":{}}',
    ])
      expect(parseSavedItems(raw).trips).toEqual([]);
  });
  it("preserves explicitly saved precise origins and readable offline directions", () => {
    const trip = {
      id: "trip-1",
      resourceId: "bridge",
      need: "food",
      mode: "walking",
      savedAt: "2026-10-17T18:00:00Z",
      origin: {
        coordinates: { lat: 30.6501234, lng: -96.3505678 },
        label: "Your starting point",
      },
      route: {
        label: "Saved scheduled directions",
        steps: ["Call to confirm before traveling."],
      },
    };
    const saved = parseSavedItems(
      JSON.stringify({ version: 1, resourceIds: [], trips: [trip] }),
    );
    expect(saved.trips[0].origin?.coordinates).toEqual(trip.origin.coordinates);
    const text = savedTripText(saved.trips[0], {
      name: "Recorded resource",
      address: "Recorded address",
      hours: "Hours not confirmed",
    });
    expect(text).toContain("Call to confirm before traveling.");
    expect(text).toContain("Created:");
    expect(text).toContain("Visit requirements: Eligibility not verified.");
    expect(text).toContain("No source details are recorded");
    expect(text).toContain("may be out of date");
    expect(text).toContain("not live directions");
  });
  it("exports a dated snapshot with visit requirements and source freshness", () => {
    const trip = {
      id: "trip-2",
      resourceId: "pantry-2",
      need: "food",
      mode: "walking",
      savedAt: "2026-10-24T12:00:00.000Z",
    } as const;
    const text = savedTripText(trip, {
      name: "Community Pantry",
      address: "123 Main St",
      hours: "Tuesdays, 10–12",
      eligibility: "Brazos County residents",
      pedestrianPickup: "unknown",
      sources: [
        {
          title: "Provider website",
          url: "https://example.org/pantry",
          checkedOn: "2026-10-22",
        },
      ],
    });
    expect(text).toContain("Created:");
    expect(text).toContain("Visit requirements: Brazos County residents");
    expect(text).toContain("Provider website (checked 2026-10-22)");
    expect(text).toContain("https://example.org/pantry");
    expect(text).toContain("Pedestrian pickup access: unknown");
    expect(text).toContain("snapshot may be out of date");
    expect(text).not.toContain("map tiles");
  });
  it("does not restore invalid coordinates from browser storage", () => {
    const saved = parseSavedItems(
      JSON.stringify({
        version: 1,
        resourceIds: [],
        trips: [
          {
            id: "trip-1",
            resourceId: "bridge",
            need: "food",
            mode: "walking",
            savedAt: "2026-10-17T18:00:00Z",
            origin: { coordinates: { lat: 91, lng: 0 }, label: "Invalid" },
          },
        ],
      }),
    );
    expect(saved.trips[0].origin).toBeUndefined();
  });
});
