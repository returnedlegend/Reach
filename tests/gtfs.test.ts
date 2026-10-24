import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { productionData, productionDefaults } from "../src/data/coverage";
import { PublishedTimetableProvider } from "../src/lib/transit";
import { planVisits } from "../src/lib/planner";
import timetable from "../src/data/btd-timetable.json";

describe("official BTD snapshot integration", () => {
  it("reproduces the committed projection from the original ZIP without modifying files", () => {
    const output = execFileSync(
      process.env.REACH_PYTHON ||
        (process.platform === "win32" ? "python" : "python3"),
      [
        "-c",
        `import importlib.util,json,pathlib
spec=importlib.util.spec_from_file_location('btd','scripts/import-btd.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
result=m.import_feed(pathlib.Path('data/transit/btd-2026-10-15.zip'))
print(json.dumps(result[0]))`,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual(timetable);
  });
  it("matches manually checked GTFS legs, including the one-transfer return", () => {
    const provider = new PublishedTimetableProvider(productionData.transit);
    const outbound = provider.journeys(
      "2026-10-22",
      "126",
      "127",
      8 * 60,
      9 * 60,
    );
    expect(outbound[0].departure).toBe(8 * 60 + 48);
    expect(outbound[0].arrival).toBe(8 * 60 + 49);
    const back = provider.journeys(
      "2026-10-22",
      "127",
      "126",
      9 * 60 + 35,
      12 * 60,
    );
    expect(back[0].departure).toBe(9 * 60 + 49);
    expect(back[0].arrival).toBe(11 * 60 + 15);
    expect(back[0].segments.filter((x) => x.kind === "bus")).toHaveLength(2);
    // This validates a conflicting published schedule, not a safe pantry walk.
    expect(productionData.transit.uncertainties?.[0]).toContain("differ");
  });
  it("applies the official holiday overlay and feed expiry", () => {
    const provider = new PublishedTimetableProvider(productionData.transit);
    for (const date of ["2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25"])
      expect(provider.journeys(date, "126", "127", 0, 1440)).toEqual([]);
    expect(provider.isValid("2027-01-04")).toBe(false);
  });
  it("never converts unreviewed real walking links into a feasible pantry trip", () => {
    const results = planVisits(productionDefaults, productionData);
    expect(results).toHaveLength(productionData.pantries.length);
    expect(results.some((x) => x.status === "fits")).toBe(false);
    expect(results.every((x) => x.segments.length === 0)).toBe(true);
    expect(
      results.some(
        (x) =>
          x.status === "confirm" &&
          x.reasons.some((r) => r.includes("walk connection")),
      ),
    ).toBe(true);
  });
});
