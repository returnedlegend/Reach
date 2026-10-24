import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoverageGeometry } from "../src/lib/coverage-types";
import { pointInCoverage } from "../src/lib/district-geometry";

const censusCoverage = JSON.parse(
  readFileSync(join(process.cwd(), "data/geo/tx10-119.geojson"), "utf8"),
) as { features: Array<{ geometry: CoverageGeometry }> };
const texas10 = censusCoverage.features[0].geometry;

describe("TX-10 coverage geometry", () => {
  it.each([
    ["Bryan", { lat: 30.674241, lng: -96.3757 }, true],
    ["Brenham", { lat: 30.166, lng: -96.397 }, true],
    ["Giddings", { lat: 30.182, lng: -96.936 }, true],
    ["Austin", { lat: 30.267, lng: -97.743 }, false],
    ["Katy", { lat: 29.785, lng: -95.824 }, false],
  ])(
    "classifies %s against the official TX-10 feature",
    (_name, point, inside) => {
      expect(pointInCoverage(point, texas10)).toBe(inside);
    },
  );

  it("supports polygon holes and treats polygon boundaries as covered", () => {
    const polygon: CoverageGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    };
    expect(pointInCoverage({ lat: 1, lng: 1 }, polygon)).toBe(true);
    expect(pointInCoverage({ lat: 5, lng: 5 }, polygon)).toBe(false);
    expect(pointInCoverage({ lat: 3, lng: 5 }, polygon)).toBe(true);
    expect(pointInCoverage({ lat: 0, lng: 5 }, polygon)).toBe(true);
    expect(pointInCoverage({ lat: 11, lng: 5 }, polygon)).toBe(false);
  });

  it("supports disjoint multipolygon pieces", () => {
    const multipolygon: CoverageGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
            [10, 10],
          ],
        ],
      ],
    };
    expect(pointInCoverage({ lat: 1, lng: 1 }, multipolygon)).toBe(true);
    expect(pointInCoverage({ lat: 11, lng: 11 }, multipolygon)).toBe(true);
    expect(pointInCoverage({ lat: 5, lng: 5 }, multipolygon)).toBe(false);
  });
});
