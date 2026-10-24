import { afterEach, describe, expect, it, vi } from "vitest";
import staticGTFS from "../src/data/btd-timetable.json";
import { productionData } from "../src/data/coverage";
import {
  chicagoNow,
  googleMapsUrl,
  nextScheduledJourney,
  validCoordinates,
  type Coordinates,
} from "../src/lib/journey";
import { PublishedTimetableProvider } from "../src/lib/transit";
import type { PublishedTimetable } from "../src/lib/types";

const point = (id: string): Coordinates => {
  const stop = staticGTFS.stops.find((candidate) => candidate.id === id)!;
  return { lat: stop.lat, lng: stop.lon };
};
const terminal = point("126");
const parker = point("127");
const next = (instant: string) =>
  nextScheduledJourney(terminal, parker, new Date(instant));

afterEach(() => vi.restoreAllMocks());

describe("coordinate directions", () => {
  it("accepts finite numeric coordinates including zero and rejects malformed values", () => {
    expect(validCoordinates({ lat: 0, lng: 0 })).toBe(true);
    expect(validCoordinates({ lat: -90, lng: 180 })).toBe(true);
    for (const value of [
      null,
      undefined,
      { lat: "30", lng: -96 },
      { lat: NaN, lng: -96 },
      { lat: 30, lng: Infinity },
      { lat: 91, lng: -96 },
      { lat: 30, lng: -181 },
      { lat: 30, lon: -96 },
    ])
      expect(validCoordinates(value)).toBe(false);
  });
  it.each(["walking", "transit", "driving"] as const)(
    "builds Google directions with the actual endpoints for %s",
    (mode) => {
      const url = new URL(googleMapsUrl(terminal, parker, mode));
      expect(url.origin + url.pathname).toBe(
        "https://www.google.com/maps/dir/",
      );
      expect(url.searchParams.get("api")).toBe("1");
      expect(url.searchParams.get("origin")).toBe(
        `${terminal.lat},${terminal.lng}`,
      );
      expect(url.searchParams.get("destination")).toBe(
        `${parker.lat},${parker.lng}`,
      );
      expect(url.searchParams.get("travelmode")).toBe(mode);
    },
  );
  it("rejects invalid endpoints before constructing a directions URL", () => {
    expect(() =>
      googleMapsUrl({ lat: NaN, lng: 0 }, parker, "transit"),
    ).toThrow();
  });
});

describe("current Chicago time", () => {
  it.each([
    ["2026-10-23T03:30:00Z", "2026-10-22", "22:30"],
    ["2026-01-16T06:00:00Z", "2026-01-16", "00:00"],
    ["2026-03-08T07:59:00Z", "2026-03-08", "01:59"],
    ["2026-03-08T08:00:00Z", "2026-03-08", "03:00"],
    ["2026-11-01T06:30:00Z", "2026-11-01", "01:30"],
    ["2026-11-01T07:30:00Z", "2026-11-01", "01:30"],
    ["2026-11-01T08:00:00Z", "2026-11-01", "02:00"],
  ])(
    "converts %s independently of the host timezone",
    (instant, date, time) => {
      expect(chicagoNow(new Date(instant))).toEqual({ date, time });
    },
  );
  it("rejects an invalid date rather than inventing the current time", () => {
    expect(() => chicagoNow(new Date("invalid"))).toThrow(RangeError);
    expect(
      nextScheduledJourney(terminal, parker, new Date("invalid")).status,
    ).toBe("unavailable");
  });
});

describe("official scheduled departures from now", () => {
  it("uses the current Chicago date and departure with official provenance and conflict disclosure", () => {
    const result = next("2026-10-22T13:45:00Z");
    expect(result.status).toBe("scheduled");
    if (result.status !== "scheduled") throw new Error(result.message);
    expect(result.date).toBe("2026-10-22");
    expect(result.journey.departure).toBe(8 * 60 + 48);
    expect(result.journey.arrival).toBe(8 * 60 + 49);
    expect(
      result.journey.segments.every((segment) => segment.kind !== "walk"),
    ).toBe(true);
    expect(result.sources.map((source) => source.id)).toEqual([
      "btd-gtfs",
      "btd-holidays",
    ]);
    expect(result.sources.some((source) => source.fictional)).toBe(false);
    expect(result.message).toMatch(/static timetable, not live arrivals/);
    expect(result.message).toMatch(/GTFS times differ.*PDF/);
    expect(result.message).toMatch(/app planning assumption/);
  });
  it("requires a full two-minute buffer including seconds and milliseconds", () => {
    expect(next("2026-10-22T13:46:00Z").journey?.departure).toBe(528);
    expect(next("2026-10-22T13:46:00.001Z").journey?.departure).toBe(588);
    expect(next("2026-10-22T13:46:59Z").journey?.departure).toBe(588);
    expect(next("2026-10-22T13:48:00Z").journey?.departure).toBe(588);
  });
  it("retains official transfer legs and the existing transfer margin", () => {
    const result = nextScheduledJourney(
      parker,
      terminal,
      new Date("2026-10-22T14:35:00Z"),
    );
    expect(result.status).toBe("scheduled");
    expect(result.journey?.departure).toBe(9 * 60 + 49);
    expect(result.journey?.arrival).toBe(11 * 60 + 15);
    expect(
      result.journey?.segments.filter((segment) => segment.kind === "bus"),
    ).toHaveLength(2);
    const transfer = result.journey?.segments.find(
      (segment) => segment.kind === "wait",
    );
    expect(transfer).toBeDefined();
    expect(transfer!.end - transfer!.start).toBeGreaterThanOrEqual(5);
  });
  it("recomputes after missed service using now rather than skipping only one old departure", () => {
    // The previous skipDepartures approach has no current-time input. After
    // several missed buses, skipping one result from 08:00 still offers 09:48.
    const oldDepartures = new PublishedTimetableProvider(productionData.transit)
      .journeys("2026-10-22", "126", "127", 480, 1440)
      .sort((a, b) => a.departure - b.departure);
    expect(oldDepartures[1].departure).toBe(588);
    expect(next("2026-10-22T15:00:00Z").journey?.departure).toBe(648);
  });
  it("does not turn an arbitrary nearby coordinate into an implied walk", () => {
    const now = new Date("2026-10-22T13:45:00Z");
    expect(
      nextScheduledJourney(
        { ...terminal, lat: terminal.lat + 0.000009 },
        parker,
        now,
      ).status,
    ).toBe("scheduled");
    const originUnknown = nextScheduledJourney(
      { ...terminal, lat: terminal.lat + 0.000011 },
      parker,
      now,
    );
    expect(originUnknown.status).toBe("unavailable");
    expect(originUnknown.message).toMatch(
      /Walking connections.*not been reviewed/,
    );
    expect(
      nextScheduledJourney(
        terminal,
        { ...parker, lng: parker.lng + 0.000011 },
        now,
      ).status,
    ).toBe("unavailable");
    expect(nextScheduledJourney(terminal, terminal, now).status).toBe(
      "unavailable",
    );
    expect(nextScheduledJourney({ lat: NaN, lng: 0 }, parker, now).status).toBe(
      "unavailable",
    );
  });
  it.each([
    "2026-10-24T13:00:00Z", // Saturday
    "2026-11-26T14:00:00Z", // Thanksgiving closure
    "2026-11-27T14:00:00Z", // Day after Thanksgiving closure
    "2026-12-24T14:00:00Z", // Christmas Eve closure
    "2026-12-25T14:00:00Z", // Christmas closure
  ])("respects official calendars and closures at %s", (instant) => {
    expect(next(instant).status).toBe("unavailable");
  });
  it("checks Chicago's date when UTC is already the following day", () => {
    const result = next("2026-10-23T00:45:00Z");
    expect(result.date).toBe("2026-10-22");
    expect(result.journey?.departure).toBe(19 * 60 + 48);
  });
  it("includes the final departure only with its full buffer and reports after-last honestly", () => {
    expect(next("2026-10-23T00:46:00Z").journey?.departure).toBe(1188);
    const result = next("2026-10-23T00:46:01Z");
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/No scheduled BTD journey remains today/);
    expect(next("2026-10-23T01:00:00Z").status).toBe("unavailable");
  });
  it("does not promise ambiguous times on a Chicago DST transition", () => {
    const result = next("2026-11-01T06:30:00Z");
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/clock changes/);
  });
  it.each(["2025-07-14T14:00:00Z", "2027-01-04T14:00:00Z"])(
    "refuses a date outside published feed validity: %s",
    (instant) => {
      const result = next(instant);
      expect(result.status).toBe("unavailable");
      expect(result.message).toMatch(/no validated schedule for today/);
    },
  );

  it("preserves previous service-day times and exceptions through the existing provider", () => {
    // Fictional overnight timetable is isolated to this provider seam; no
    // production records or official source claims are changed.
    const fixture: PublishedTimetable = {
      timezone: "America/Chicago",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      minTransferMinutes: 5,
      stops: [
        { id: "126", name: "Fictional A" },
        { id: "127", name: "Fictional B" },
      ],
      sources: [
        { id: "fiction", title: "Fictional overnight test", fictional: true },
      ],
      calendars: [
        {
          id: "fiction",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          weekdays: [4],
        },
      ],
      trips: [
        {
          id: "fictional-overnight",
          route: "Fictional route",
          serviceId: "fiction",
          sourceIds: ["fiction"],
          stops: [
            { stopId: "126", arrival: "25:10", departure: "25:10" },
            { stopId: "127", arrival: "25:20", departure: "25:20" },
          ],
        },
      ],
    };
    const original = PublishedTimetableProvider.prototype.journeys;
    const spy = vi.spyOn(PublishedTimetableProvider.prototype, "journeys");
    const useFixtureOnce = () =>
      spy.mockImplementationOnce(function (...args) {
        return original.apply(new PublishedTimetableProvider(fixture), args);
      });
    useFixtureOnce();
    const result = next("2026-10-23T06:00:00Z"); // Friday 01:00, Thursday service
    expect(result.journey?.departure).toBe(70);
    expect(result.journey?.arrival).toBe(80);
    expect(spy).toHaveBeenLastCalledWith("2026-10-23", "126", "127", 62, 2879);
    fixture.calendars[0].exceptions = { "2026-10-22": false };
    useFixtureOnce();
    expect(next("2026-10-23T06:00:00Z").status).toBe("unavailable");
  });
});
