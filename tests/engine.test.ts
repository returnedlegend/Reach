import { describe, expect, it } from "vitest";
import type { PlannerData, PlannerInput } from "../src/lib/types";
import { planVisits, validateInput } from "../src/lib/planner";
import { matchesRule } from "../src/lib/recurrence";
import { PublishedTimetableProvider } from "../src/lib/transit";
import { hasChicagoClockChange, parseTime } from "../src/lib/time";

// All locations, routes, schedules, and sources in these fixtures are fictional.
const source = {
  id: "fiction",
  title: "Fictional test source",
  fictional: true,
};
function fixture(): PlannerData {
  return {
    origins: [
      {
        id: "home",
        name: "Fictional home",
        walkConnections: [
          { stopId: "a", minutes: 5, miles: 0.2, reviewed: true },
        ],
      },
    ],
    pantries: [
      {
        id: "pantry",
        name: "Fictional pantry",
        address: "Fictional address",
        sources: [source],
        windows: [
          {
            id: "window",
            rule: { kind: "weekly", weekdays: [4] },
            opens: "09:00",
            closes: "12:00",
            registrationCutoff: "10:00",
            policyKnown: true,
            appointmentRequired: false,
            sourceIds: ["fiction"],
          },
        ],
        walkConnections: [
          { stopId: "b", minutes: 5, miles: 0.2, reviewed: true },
        ],
        directWalks: [
          { originId: "home", minutes: 20, miles: 1, reviewed: true },
        ],
      },
    ],
    transit: {
      timezone: "America/Chicago",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      minTransferMinutes: 5,
      sources: [source],
      stops: [
        { id: "a", name: "Fiction A" },
        { id: "b", name: "Fiction B" },
      ],
      calendars: [
        {
          id: "service",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          weekdays: [4],
        },
      ],
      trips: [
        {
          id: "out",
          route: "Fiction 1",
          serviceId: "service",
          stops: [
            { stopId: "a", arrival: "09:00", departure: "09:00" },
            { stopId: "b", arrival: "09:20", departure: "09:20" },
          ],
          sourceIds: ["fiction"],
        },
        {
          id: "later",
          route: "Fiction 1",
          serviceId: "service",
          stops: [
            { stopId: "a", arrival: "10:00", departure: "10:00" },
            { stopId: "b", arrival: "10:15", departure: "10:15" },
          ],
          sourceIds: ["fiction"],
        },
        {
          id: "back",
          route: "Fiction 1",
          serviceId: "service",
          stops: [
            { stopId: "b", arrival: "11:00", departure: "11:00" },
            { stopId: "a", arrival: "11:20", departure: "11:20" },
          ],
          sourceIds: ["fiction"],
        },
      ],
    },
  };
}
const input: PlannerInput = {
  originId: "home",
  date: "2026-10-08",
  earliestDeparture: "08:30",
  latestReturn: "12:00",
  mode: "bus",
  maxWalkMiles: 1,
  visitMinutes: 20,
  appointmentStatus: "unknown",
};

describe("round-trip planning with fictional published timetables", () => {
  it("finds a complete trip with walking, wait, visit, return, and provenance", () => {
    const result = planVisits(input, fixture())[0];
    expect(result.status).toBe("fits");
    expect(result.arrival).toBe(565);
    expect(result.returnAt).toBe(685);
    expect(result.walkingMiles).toBe(0.8);
    expect(result.segments.filter((s) => s.kind === "bus")).toHaveLength(2);
    expect(result.sources[0].fictional).toBe(true);
    expect(result.segments[0].start).toBe(530);
    expect(result.segments[1]).toMatchObject({
      kind: "wait",
      start: 535,
      end: 540,
    });
  });
  it("arriving at the bus departure time is insufficient with the default five-minute boarding buffer", () => {
    expect(
      planVisits({ ...input, earliestDeparture: "08:55" }, fixture())[0].status,
    ).toBe("no");
    expect(
      planVisits(
        { ...input, earliestDeparture: "08:55", boardingBufferMinutes: 0 },
        fixture(),
      )[0].status,
    ).toBe("fits");
    expect(
      validateInput({ ...input, boardingBufferMinutes: -1 }, fixture()),
    ).toContain("Boarding buffer must be zero or greater.");
  });
  it("the return bus also requires five minutes at the stop before departure", () => {
    const data = fixture();
    data.transit.trips[2].stops = [
      { stopId: "b", arrival: "10:00", departure: "10:00" },
      { stopId: "a", arrival: "10:20", departure: "10:20" },
    ];
    expect(planVisits(input, data)[0].status).toBe("no");
    expect(
      planVisits({ ...input, boardingBufferMinutes: 0 }, data)[0].status,
    ).toBe("fits");
  });
  it("a larger boarding margin also applies at transfers", () => {
    const data = fixture();
    data.transit.trips[0].stops[1].stopId = "transfer";
    data.transit.trips[1].stops = [
      { stopId: "transfer", arrival: "09:25", departure: "09:25" },
      { stopId: "b", arrival: "09:35", departure: "09:35" },
    ];
    expect(planVisits(input, data)[0].status).toBe("fits");
    expect(
      planVisits({ ...input, boardingBufferMinutes: 10 }, data)[0].status,
    ).toBe("no");
  });
  it("A: rejects arrival 10:20 after 10:00 registration even when distribution ends at noon", () => {
    expect(
      planVisits(
        { ...input, earliestDeparture: "09:30" },
        fixture(),
      )[0].reasons.join(),
    ).toMatch(/registration cutoff/);
    expect(
      planVisits({ ...input, earliestDeparture: "09:30" }, fixture())[0].status,
    ).toBe("no");
  });
  it("B: rejects an outbound fit when the return misses the deadline", () => {
    expect(
      planVisits(
        { ...input, latestReturn: "11:15" },
        fixture(),
      )[0].reasons.join(),
    ).toMatch(/return meets your deadline/);
  });
  it("C: second Thursday does not match the third Thursday", () => {
    const data = fixture();
    data.pantries[0].windows[0].rule = {
      kind: "nth-weekday",
      weekday: 4,
      nth: 2,
    };
    expect(planVisits(input, data)[0].status).toBe("fits");
    expect(planVisits({ ...input, date: "2026-10-15" }, data)[0].status).toBe(
      "no",
    );
  });
  it("D: unknown pedestrian access at drive-through requires confirmation", () => {
    const data = fixture();
    data.pantries[0].pickupFormat = "drive-through";
    data.pantries[0].pedestrianPickup = "unknown";
    expect(planVisits(input, data)[0].status).toBe("confirm");
  });
  it("unknown appointment requirements cannot produce a fit even with known general policy", () => {
    const data = fixture();
    delete data.pantries[0].windows[0].appointmentRequired;
    expect(planVisits(input, data)[0].status).toBe("confirm");
    expect(planVisits(input, data)[0].reasons.join()).toMatch(
      /appointment is required is unknown/,
    );
  });
  it("E: a holiday service exception cancels the transit round trip", () => {
    const data = fixture();
    data.transit.calendars[0].exceptions = { "2026-10-08": false };
    expect(planVisits(input, data)[0].status).toBe("no");
    data.pantries[0].walkConnections = [];
    expect(planVisits(input, data)[0].status).toBe("no");
    expect(planVisits(input, data)[0].reasons.join()).toMatch(
      /No published transit service/,
    );
  });
  it("F: leaving one departure later misses registration", () => {
    expect(
      planVisits({ ...input, skipDepartures: 1 }, fixture())[0].status,
    ).toBe("no");
  });
  it("G: conflicting published hours require confirmation", () => {
    const data = fixture();
    data.pantries[0].windows[0].conflictingSources = true;
    expect(planVisits(input, data)[0].status).toBe("confirm");
  });
  it("enforces appointments, closure dates, and reviewed walking links", () => {
    const data = fixture();
    data.pantries[0].windows[0].appointmentRequired = true;
    expect(
      planVisits({ ...input, appointmentStatus: "not-booked" }, data)[0].status,
    ).toBe("no");
    expect(planVisits(input, data)[0].status).toBe("confirm");
    expect(
      planVisits({ ...input, appointmentStatus: "booked" }, data)[0].status,
    ).toBe("confirm");
    data.pantries[0].closures = [input.date];
    expect(planVisits(input, data)[0].status).toBe("no");
    data.pantries[0].closures = [];
    data.pantries[0].walkConnections[0].reviewed = false;
    expect(planVisits(input, data)[0].status).toBe("confirm");
  });
  it("enforces total walking budget and does not assume a direct walk exists", () => {
    expect(
      planVisits({ ...input, maxWalkMiles: 0.7 }, fixture())[0].status,
    ).toBe("no");
    expect(
      planVisits({ ...input, mode: "walk", maxWalkMiles: 2 }, fixture())[0]
        .status,
    ).toBe("fits");
    const data = fixture();
    data.pantries[0].directWalks = [];
    expect(
      planVisits({ ...input, mode: "walk", maxWalkMiles: 2 }, data)[0].status,
    ).toBe("confirm");
  });
  it("refuses stale transit coverage and malformed inputs", () => {
    expect(
      planVisits({ ...input, date: "2027-10-07" }, fixture())[0].status,
    ).toBe("confirm");
    expect(
      validateInput(
        { ...input, date: "2026-02-30", earliestDeparture: "25:00" },
        fixture(),
      ),
    ).toHaveLength(2);
  });
  it("registers before distribution opens and waits for the distribution window", () => {
    const data = fixture();
    Object.assign(data.pantries[0].windows[0], {
      registrationOpens: "09:00",
      registrationCutoff: "09:45",
      opens: "10:00",
    });
    const result = planVisits(input, data)[0];
    expect(result.status).toBe("fits");
    expect(result.segments.find((s) => s.kind === "visit")?.start).toBe(600);
    expect(
      result.segments.some(
        (s) => s.kind === "wait" && s.to === "pantry" && s.end === 600,
      ),
    ).toBe(true);
  });
  it("registration opening affects cutoff feasibility", () => {
    const data = fixture();
    Object.assign(data.pantries[0].windows[0], {
      registrationOpens: "10:05",
      registrationCutoff: "10:00",
    });
    expect(planVisits(input, data)[0].status).toBe("no");
  });
  it("does not resolve conflicting windows by selecting a convenient alternative", () => {
    const data = fixture();
    data.pantries[0].windows.push({
      ...data.pantries[0].windows[0],
      id: "conflict",
      closes: "09:10",
      conflictingSources: true,
    });
    expect(planVisits(input, data)[0].status).toBe("confirm");
  });
  it("unknown documents and unresolved schedule or transit sources cannot produce fits", () => {
    const documents = fixture();
    documents.pantries[0].documents = [
      { name: "Fictional document", requirement: "unknown" },
    ];
    expect(planVisits(input, documents)[0].status).toBe("confirm");
    const pantrySource = fixture();
    pantrySource.pantries[0].windows[0].sourceIds = ["missing"];
    expect(planVisits(input, pantrySource)[0].status).toBe("confirm");
    const transitSource = fixture();
    transitSource.transit.trips[0].sourceIds = ["missing"];
    expect(planVisits(input, transitSource)[0].status).toBe("confirm");
  });
  it("never silently turns walk mode into a bus return", () => {
    const result = planVisits(
      { ...input, mode: "walk", maxWalkMiles: 2 },
      fixture(),
    )[0];
    expect(result.status).toBe("fits");
    expect(result.segments.some((s) => s.kind === "bus")).toBe(false);
    expect(result.segments.at(-1)?.to).toBe("home");
  });
});

describe("calendar and transit edge cases", () => {
  it("matches only the first four Saturdays, excluding the fifth", () => {
    const rule = { kind: "first-weekdays" as const, weekday: 6, count: 4 };
    expect(matchesRule(rule, "2026-10-24")).toBe(true);
    expect(matchesRule(rule, "2026-10-31")).toBe(false);
    expect(matchesRule(rule, "2026-10-23")).toBe(false);
  });
  it("supports previous service day times beyond midnight", () => {
    const data = fixture();
    data.transit.trips[0].stops = [
      { stopId: "a", arrival: "25:00", departure: "25:00" },
      { stopId: "b", arrival: "25:20", departure: "25:20" },
    ];
    expect(parseTime("25:20", true)).toBe(1520);
    const trips = new PublishedTimetableProvider(data.transit).journeys(
      "2026-10-09",
      "a",
      "b",
      30,
      120,
    );
    expect(trips[0].arrival).toBe(80);
    expect(trips[0].departure).toBe(60);
  });
  it("requires the minimum transfer buffer and never invents transfer walking", () => {
    const data = fixture();
    data.transit.trips = [
      {
        ...data.transit.trips[0],
        stops: [
          { stopId: "a", arrival: "09:00", departure: "09:00" },
          { stopId: "x", arrival: "09:20", departure: "09:20" },
        ],
      },
      {
        ...data.transit.trips[1],
        stops: [
          { stopId: "x", arrival: "09:24", departure: "09:24" },
          { stopId: "b", arrival: "09:40", departure: "09:40" },
        ],
      },
    ];
    expect(
      new PublishedTimetableProvider(data.transit).journeys(
        input.date,
        "a",
        "b",
        500,
        700,
      ),
    ).toHaveLength(0);
    data.transit.trips[1].stops[0].departure = "09:25";
    expect(
      new PublishedTimetableProvider(data.transit)
        .journeys(input.date, "a", "b", 500, 700)[0]
        .segments.filter((s) => s.kind === "bus"),
    ).toHaveLength(2);
    data.transit.trips[1].stops[0].stopId = "nearby-unreviewed";
    expect(
      new PublishedTimetableProvider(data.transit).journeys(
        input.date,
        "a",
        "b",
        500,
        700,
      ),
    ).toHaveLength(0);
  });
  it("an added service exception can run on an otherwise inactive weekday", () => {
    const data = fixture();
    data.transit.calendars[0].exceptions = { "2026-10-09": true };
    expect(
      new PublishedTimetableProvider(data.transit).journeys(
        "2026-10-09",
        "a",
        "b",
        500,
        700,
      ).length,
    ).toBeGreaterThan(0);
  });
  it("same-stop travel does not invent a bus or an impossible time interval", () => {
    const provider = new PublishedTimetableProvider(fixture().transit);
    expect(provider.journeys(input.date, "a", "a", 600, 590)).toEqual([]);
    expect(provider.journeys(input.date, "a", "a", 600, 610)).toEqual([
      { departure: 600, arrival: 600, segments: [] },
    ]);
  });
  it("uses Chicago clock-change dates and never promises an ambiguous overnight fit", () => {
    expect(hasChicagoClockChange("2026-11-01")).toBe(true);
    expect(hasChicagoClockChange("2026-03-08")).toBe(true);
    expect(hasChicagoClockChange("2026-10-08")).toBe(false);
    const data = fixture();
    Object.assign(data.pantries[0].windows[0], {
      rule: { kind: "weekly", weekdays: [0] },
      opens: "01:00",
      closes: "04:00",
      registrationCutoff: "03:00",
    });
    const result = planVisits(
      {
        ...input,
        date: "2026-11-01",
        mode: "walk",
        maxWalkMiles: 2,
        earliestDeparture: "00:30",
        latestReturn: "04:00",
      },
      data,
    )[0];
    expect(result.status).toBe("confirm");
    expect(result.reasons.join()).toMatch(/clock change/);
  });
});
