import { describe, expect, it } from "vitest";
import { chicagoWallInstant } from "../src/lib/access-time";

describe("private availability Chicago wall-clock expiry", () => {
  it("converts winter and summer local deadlines independently of the host timezone", () => {
    expect(chicagoWallInstant("2026-01-15", "12:30")?.toISOString()).toBe("2026-01-15T18:30:00.000Z");
    expect(chicagoWallInstant("2026-07-15", "12:30")?.toISOString()).toBe("2026-07-15T17:30:00.000Z");
  });
  it("refuses the actual nonexistent and repeated Chicago clock-change times", () => {
    expect(chicagoWallInstant("2026-03-08", "02:30")).toBeNull();
    expect(chicagoWallInstant("2026-11-01", "01:30")).toBeNull();
    expect(chicagoWallInstant("2026-11-01", "02:30")?.toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });
  it("normalizes after-midnight service times before checking the next day's clock", () => {
    expect(chicagoWallInstant("2026-10-22", "25:10")?.toISOString()).toBe("2026-10-23T06:10:00.000Z");
    expect(chicagoWallInstant("2026-10-31", "25:30")).toBeNull();
    expect(chicagoWallInstant("2026-10-22", "48:00")).toBeNull();
    expect(chicagoWallInstant("2026-02-30", "12:00")).toBeNull();
  });
});
