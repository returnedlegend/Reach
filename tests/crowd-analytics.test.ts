import { describe, expect, it } from "vitest";
import {
  aggregateCrowd,
  chicagoParts,
  type CrowdObservation,
} from "../src/lib/crowd";

const obs = (day: string, level = 1, hour = 9): CrowdObservation => ({
  weekday: 1,
  hour,
  localDate: day,
  level,
  waitMinutes: 15,
  observedAt: `${day}T15:00:00.000Z`,
  reports: 1,
});

describe("crowd analytics", () => {
  it("uses America/Chicago weekday, date, and hour across daylight saving changes", () => {
    expect(chicagoParts(new Date("2026-03-08T07:30:00Z"))).toMatchObject({
      weekday: 0,
      hour: 1,
      localDate: "2026-03-08",
    });
    expect(chicagoParts(new Date("2026-03-08T08:30:00Z"))).toMatchObject({
      weekday: 0,
      hour: 3,
      localDate: "2026-03-08",
    });
    expect(chicagoParts(new Date("2026-11-01T07:30:00Z"))).toMatchObject({
      weekday: 0,
      hour: 1,
      localDate: "2026-11-01",
    });
  });

  it("keeps bins unknown until three reports qualify on each of three local dates", () => {
    const sparse = [
      obs("2026-01-05", 1),
      obs("2026-01-05", 1),
      obs("2026-01-06", 1),
      obs("2026-01-06", 1),
      obs("2026-01-07", 1),
      obs("2026-01-07", 1),
    ];
    const threeDays = [
      ...sparse,
      obs("2026-01-05"),
      obs("2026-01-06"),
      obs("2026-01-07"),
    ];
    const now = new Date("2026-01-09T16:00:00Z");
    expect(
      aggregateCrowd({ pantryId: "p", observations: sparse, now }).days[1]
        .hours[9],
    ).toMatchObject({ level: null, status: "insufficient", confidence: null });
    expect(
      aggregateCrowd({ pantryId: "p", observations: threeDays, now }).days[1]
        .hours[9],
    ).toMatchObject({
      level: 1,
      status: "observed",
      confidence: "low",
      waitMinutes: 15,
    });
  });

  it("does not reveal a historical bin from one contributor repeating on five dates", () => {
    const repeated = [
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
      "2026-02-02",
    ].map((day) => obs(day));
    expect(
      aggregateCrowd({
        pantryId: "p",
        observations: repeated,
        now: new Date("2026-02-03T16:00:00Z"),
      }).days[1].hours[9].status,
    ).toBe("insufficient");
  });

  it("weights waits by reports that provided one and hides wait without three supported dates", () => {
    const observations = ["2026-01-05", "2026-01-06", "2026-01-07"].flatMap(
      (day) => [
        { ...obs(day, 0), reports: 3, waitMinutes: 20, waitReports: 1 },
        { ...obs(day, 3), reports: 3, waitMinutes: 80, waitReports: 3 },
      ],
    );
    const now = new Date("2026-01-09T16:00:00Z");
    expect(
      aggregateCrowd({ pantryId: "p", observations, now }).days[1].hours[9]
        .waitMinutes,
    ).toBe(65);
    const tooFewWaits = observations.map((o) => ({ ...o, waitReports: 1 }));
    expect(
      aggregateCrowd({ pantryId: "p", observations: tooFewWaits, now }).days[1]
        .hours[9].waitMinutes,
    ).toBeNull();
  });

  it("assigns documented confidence thresholds and excludes stale observations", () => {
    const records = Array.from({ length: 6 }, (_, i) => ({
      ...obs(`2026-01-${String(i + 1).padStart(2, "0")}`, 2),
      reports: 4,
    }));
    const summary = aggregateCrowd({
      pantryId: "p",
      observations: [...records, obs("2025-09-01")],
      now: new Date("2026-01-10T16:00:00Z"),
    });
    expect(summary.days[1].hours[9]).toMatchObject({
      level: 2,
      confidence: "high",
    });
    expect(summary.explanation).toContain("20 reports across 6 dates");
  });

  it("requires three recent reports and verified hour restrictions for recommendations", () => {
    const recent = [obs("2026-01-09"), obs("2026-01-09")];
    const summary = aggregateCrowd({
      pantryId: "p",
      observations: [],
      recent,
      now: new Date("2026-01-09T16:00:00Z"),
    });
    expect(summary.recent).toBeNull();
    expect(summary.quieterWindow).toBeNull();
  });

  it("does not combine different Chicago-local dates for recent labels around midnight", () => {
    const now = new Date("2026-01-10T07:30:00Z");
    const recent = [
      { ...obs("2026-01-09"), observedAt: "2026-01-10T05:40:00Z" },
      { ...obs("2026-01-09"), observedAt: "2026-01-10T05:45:00Z" },
      { ...obs("2026-01-10"), observedAt: "2026-01-10T06:20:00Z" },
      { ...obs("2026-01-10"), observedAt: "2026-01-10T06:25:00Z" },
    ];
    expect(
      aggregateCrowd({ pantryId: "p", observations: [], recent, now }).recent,
    ).toBeNull();
  });
});
