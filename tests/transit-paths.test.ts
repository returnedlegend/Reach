import { describe, it, expect } from "vitest";
import { transitPaths } from "../src/lib/transit-paths";
import { nextScheduledJourney } from "../src/lib/journey";
import timetable from "../src/data/btd-timetable.json";
describe("published transit geometry", () => {
  it("clips a real scheduled leg to the agency shape without using a straight stop-to-stop line", () => {
    const a = timetable.stops.find((s) => s.id === "126")!,
      b = timetable.stops.find((s) => s.id === "127")!;
    const result = nextScheduledJourney(
      { lat: a.lat, lng: a.lon },
      { lat: b.lat, lng: b.lon },
      new Date("2026-10-22T13:45:00Z"),
    );
    expect(result.status).toBe("scheduled");
    if (result.status !== "scheduled")
      throw new Error("Expected fixture service");
    const paths = transitPaths(result.journey.segments);
    expect(paths).toHaveLength(1);
    expect(paths[0].mode).toBe("bus");
    expect(paths[0].coordinates.length).toBeGreaterThan(2);
    for (const [lng, lat] of paths[0].coordinates) {
      expect(lng).toBeLessThan(-96);
      expect(lat).toBeGreaterThan(30);
    }
    expect(paths[0].coordinates[0][0]).toBeCloseTo(a.lon, 2);
    expect(paths[0].coordinates.at(-1)![0]).toBeCloseTo(b.lon, 2);
  });
  it("does not invent a path for fictional trips or unreviewed walks", () => {
    expect(
      transitPaths([
        {
          kind: "bus",
          tripId: "fictional",
          from: "126",
          to: "127",
          start: 0,
          end: 5,
        },
        { kind: "walk", from: "unknown", to: "126", start: 0, end: 3 },
      ]),
    ).toEqual([]);
  });
});
