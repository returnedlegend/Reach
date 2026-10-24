import { describe, expect, it } from "vitest";
import { productionData } from "../src/data/coverage";
import { transitStops } from "../src/data/resources";
import { scheduledAccessJourneys, type WalkingLookup } from "../src/lib/access-routing";
import type { JourneyResult } from "../src/lib/osm-services";
import type { AccessInput } from "../src/lib/access-types";
import { PublishedTimetableProvider } from "../src/lib/transit";
import { formatTime } from "../src/lib/time";
import type { MapCoordinates } from "../src/lib/map-types";
import type { PublishedTimetable, TransitTrip } from "../src/lib/types";

const DATE = "2026-10-23"; // Synthetic Friday; not a clock-change date.
const point = (lat: number, lng: number): MapCoordinates => ({ lat, lng });
const a = point(30, -96), x = point(30.1, -96), d = point(30.2, -96), c = point(30.3, -96);
const stops = [
  { id: "A", name: "Synthetic A", ...a }, { id: "X", name: "Synthetic transfer X", ...x },
  { id: "D", name: "Synthetic D", ...d }, { id: "C", name: "Synthetic C", ...c },
];
const input = (overrides: Partial<AccessInput> = {}): AccessInput => ({
  origin: a, date: DATE, departure: "08:00", mode: "transit", maxWalkingMinutes: 30,
  maxWalkingMiles: 2, fareBudget: 20, maxTransfers: 1, mobility: "standard",
  appointment: "booked", eligibilityConfirmed: true, dietaryPreference: "",
  dietaryRequired: false, visitMinutes: 20, arrivalBufferMinutes: 10,
  allowWaiting: true, ...overrides,
});
function timetable(trips: TransitTrip[], opts: { validFrom?: string; validTo?: string; exceptions?: Record<string, boolean>; minTransferMinutes?: number } = {}): PublishedTimetable {
  return {
    timezone: "America/Chicago", validFrom: opts.validFrom || "2026-10-20", validTo: opts.validTo || "2026-10-31",
    minTransferMinutes: opts.minTransferMinutes ?? 5, sources: [{ id: "synthetic-gtfs", title: "Synthetic timetable", fictional: true }],
    stops: stops.map(({ id, name }) => ({ id, name })),
    calendars: [{ id: "weekday", startDate: "2026-10-20", endDate: "2026-10-31", weekdays: [1, 2, 3, 4, 5], exceptions: opts.exceptions }],
    trips,
  };
}
function trip(id: string, route: string, pairs: Array<[string, string, string]>, sourceIds = ["synthetic-gtfs"]): TransitTrip {
  return { id, route, serviceId: "weekday", sourceIds, stops: pairs.map(([stopId, arrival, departure]) => ({ stopId, arrival, departure })) };
}
const availableWalk = (minutes = 0, miles = 0): JourneyResult => ({
  status: "available", distanceMiles: miles, durationMinutes: minutes, label: "Synthetic walking leg",
  steps: [{ instruction: "Synthetic walk" }], paths: [], attribution: [],
});
const unavailableWalk: JourneyResult = { status: "unavailable", reason: "no-route", message: "No synthetic walk route." };
const exactOnly: WalkingLookup = async (from, to) =>
  from.lat === to.lat && from.lng === to.lng ? availableWalk() : unavailableWalk;

describe("scheduled access routing adapter", () => {
  it("requires the full published minimum transfer buffer and respects the transfer cap", async () => {
    const first = trip("first", "Synthetic 1", [["A", "08:10", "08:10"], ["X", "08:30", "08:30"]]);
    const tooSoon = trip("too-soon", "Synthetic 2", [["X", "08:34", "08:34"], ["D", "08:50", "08:50"]]);
    const atBuffer = trip("at-buffer", "Synthetic 2", [["X", "08:35", "08:35"], ["D", "08:51", "08:51"]]);
    const data = timetable([first, tooSoon, atBuffer], { minTransferMinutes: 5 });
    const journeys = await scheduledAccessJourneys(input(), a, d, 480, 600, exactOnly, data, stops);
    expect(journeys.some(j => j.steps.some(s => s.includes("8:34 AM")))).toBe(false);
    expect(journeys.some(j => j.transfers === 1 && j.steps.join(" ").includes("8:35 AM"))).toBe(true);
    const zeroTransfers = await scheduledAccessJourneys(input({ maxTransfers: 0 }), a, d, 480, 600, exactOnly, data, stops);
    expect(zeroTransfers).toEqual([]);
  });

  it("omits a missed last bus, a date outside feed validity, and a published holiday closure", async () => {
    const lastBus = timetable([trip("last", "Synthetic", [["A", "09:00", "09:00"], ["D", "09:30", "09:30"]])]);
    expect(await scheduledAccessJourneys(input(), a, d, 480, 569, exactOnly, lastBus, stops)).toEqual([]);

    const expired = timetable([trip("feed", "Synthetic", [["A", "09:00", "09:00"], ["D", "09:30", "09:30"]])], { validTo: "2026-10-22" });
    expect(await scheduledAccessJourneys(input(), a, d, 480, 600, exactOnly, expired, stops)).toEqual([]);

    const closedDate = "2026-10-26";
    const holiday = timetable([trip("holiday", "Synthetic", [["A", "09:00", "09:00"], ["D", "09:30", "09:30"]])], { exceptions: { [closedDate]: false } });
    expect(await scheduledAccessJourneys(input({ date: closedDate }), a, d, 480, 600, exactOnly, holiday, stops)).toEqual([]);
  });

  it("places previous-service 25:xx times on the current day and shifts next-day service by 24 hours", async () => {
    const previousService = timetable([
      trip("previous-25", "Synthetic", [["A", "25:10", "25:10"], ["D", "25:40", "25:40"]]),
    ]);
    const prev = await scheduledAccessJourneys(input({ departure: "01:00" }), a, d, 60, 120, exactOnly, previousService, stops);
    expect(prev[0]?.departure).toBe(68); // 01:10 bus less the two-minute boarding buffer.
    expect(prev[0]?.arrival).toBe(100);
    expect(prev[0]?.steps.join(" ")).toContain("1:10 AM");
    expect(prev[0]?.steps.join(" ")).not.toContain("(+1 day)");

    const nextDay = timetable([
      trip("tomorrow", "Synthetic", [["A", "00:10", "00:10"], ["D", "00:30", "00:30"]]),
    ]);
    nextDay.calendars[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
    const next = await scheduledAccessJourneys(input({ departure: "23:00" }), a, d, 1380, 1500, exactOnly, nextDay, stops);
    expect(next[0]?.departure).toBe(1448);
    expect(next[0]?.arrival).toBe(1470);
  });

  it("does not substitute straight-line proximity when a required walking route is unavailable", async () => {
    let calls = 0;
    const unavailable: WalkingLookup = async () => { calls++; return unavailableWalk; };
    const nearbyOrigin = point(30.001, -96.001), nearbyDestination = point(30.201, -96.001);
    const result = await scheduledAccessJourneys(input(), nearbyOrigin, nearbyDestination, 480, 600,
      async (from, to) => { calls++; return unavailable(from, to); },
      timetable([trip("direct", "Synthetic", [["A", "08:30", "08:30"], ["D", "09:00", "09:00"]])]), stops);
    expect(calls).toBeGreaterThan(0);
    expect(result).toEqual([]);
  });

  it("includes routed access and egress walking time and mileage in the scheduled journey", async () => {
    const origin = point(30.001, -96), destination = point(30.201, -96);
    const walking: WalkingLookup = async (from, to) => {
      if (from.lat === origin.lat && to.lat === a.lat) return availableWalk(4, 0.3);
      if (from.lat === d.lat && to.lat === destination.lat) return availableWalk(6, 0.4);
      return unavailableWalk;
    };
    const data = timetable([trip("walk-legs", "Synthetic", [["A", "08:48", "08:48"], ["D", "09:20", "09:20"]])]);
    const journeys = await scheduledAccessJourneys(input(), origin, destination, 480, 600, walking, data, stops);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].walkingMinutes).toBe(10);
    expect(journeys[0].walkingMiles).toBeCloseTo(0.7);
    expect(journeys[0].departure).toBe(522); // Walk 4m plus 2m boarding buffer before 08:48.
    expect(journeys[0].arrival).toBe(566); // Bus arrives 09:20; walk another 6m.
    expect(journeys[0].steps).toContain("Synthetic walk");

    const overBudget = await scheduledAccessJourneys(input({ maxWalkingMinutes: 9 }), origin, destination, 480, 600, walking, data, stops);
    expect(overBudget).toEqual([]);
  });

  it("matches a scheduled result to the stored BTD snapshot at exact stop coordinates only", async () => {
    const fromStop = transitStops.find(stop => stop.id === "126")!;
    const toStop = transitStops.find(stop => stop.id === "151")!;
    const calls: Array<[MapCoordinates, MapCoordinates]> = [];
    const exactOnlyProductionWalk: WalkingLookup = async (from, to) => {
      calls.push([from, to]);
      return from.lat === to.lat && from.lng === to.lng ? availableWalk() : unavailableWalk;
    };
    const earliest = 8 * 60;
    const journeys = await scheduledAccessJourneys(input({ departure: "08:00" }), fromStop, toStop, earliest, 10 * 60,
      exactOnlyProductionWalk, productionData.transit, transitStops);
    const provider = new PublishedTimetableProvider(productionData.transit);
    const snapshotTrips = provider.journeys(DATE, "126", "151", earliest + 2, 10 * 60);
    const found = journeys.find(j => j.steps.some(step => step.includes("BTD Route 00 Orange")));
    expect(found).toBeDefined();
    const busStep = found!.steps.find(step => step.includes("BTD Route 00 Orange"))!;
    expect(snapshotTrips.some(j => j.segments.some(s => {
      const expectedTimes = `${formatTime(s.start)}–${formatTime(s.end)}`;
      return busStep.includes(s.route || "") && busStep.includes(expectedTimes) && s.tripId;
    }))).toBe(true);
    expect(found!.source).toBe("scheduled");
    expect(found!.fare).toBe(1); // Published direct-ride BTD fare from production source data.
    expect(calls.some(([f, t]) => f.lat === fromStop.lat && f.lng === fromStop.lng && t.lat === fromStop.lat && t.lng === fromStop.lng)).toBe(true);

    const offStop = point(fromStop.lat + 0.0002, fromStop.lng + 0.0002);
    const offStopJourney = await scheduledAccessJourneys(input(), offStop, toStop, earliest, 10 * 60,
      exactOnlyProductionWalk, productionData.transit, transitStops);
    expect(offStopJourney).toEqual([]);
  });
});
