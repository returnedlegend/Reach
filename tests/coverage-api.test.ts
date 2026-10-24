import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "../src/app/api/coverage/route";
import { isCoverageFeature } from "../src/lib/coverage-types";
import { pointInCoverage } from "../src/lib/district-geometry";

const disk = vi.hoisted(() => ({
  broken: false,
  contents: "" as string | null,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (disk.broken) throw new Error("Synthetic unreadable asset");
      if (disk.contents !== null && String(args[0]).endsWith(".geojson")) {
        const contents = Buffer.from(disk.contents);
        let position = 0;
        return {
          stat: async () => ({ isFile: () => true, size: contents.length }),
          close: async () => {},
          read: async (buffer: Buffer, offset: number, length: number) => {
            const bytesRead = contents.copy(
              buffer,
              offset,
              position,
              position + length,
            );
            position += bytesRead;
            return { bytesRead };
          },
        };
      }
      return fs.open(...args);
    },
  };
});
afterEach(() => {
  disk.broken = false;
  disk.contents = null;
});
disk.contents = null;
const original = JSON.parse(
  readFileSync(join(process.cwd(), "data/geo/tx10-119.geojson"), "utf8"),
);

describe("public TX-10 coverage API", () => {
  it("serves the original Census geometry and provenance, without fabricated coordinates", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const feature = await response.json();
    expect(isCoverageFeature(feature)).toBe(true);
    expect(feature.geometry).toEqual(original.features[0].geometry);
    expect(feature.properties).toMatchObject({
      ...original.features[0].properties,
      geoid: "4810",
      congress: "119th Congress",
      sourceUrl:
        "https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_48_cd119.zip",
    });
    expect(
      pointInCoverage({ lat: 30.674241, lng: -96.3757 }, feature.geometry),
    ).toBe(true);
    expect(
      pointInCoverage({ lat: 30.267, lng: -97.743 }, feature.geometry),
    ).toBe(false);
  });
  it("does not replace missing source files with invented coverage", async () => {
    disk.broken = true;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("geometry");
  });
  it.each([
    "{bad json",
    JSON.stringify({ type: "FeatureCollection", features: [] }),
    JSON.stringify({
      ...original,
      features: [
        {
          ...original.features[0],
          properties: { GEOID: "wrong", CDSESSN: "119" },
        },
      ],
    }),
    "x".repeat(1024 * 1024 + 1),
  ])(
    "fails closed on invalid or oversized official assets",
    async (contents) => {
      disk.contents = contents;
      expect((await GET()).status).toBe(503);
    },
  );
  it("rejects coordinates outside WGS84 bounds", () => {
    expect(
      isCoverageFeature({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [181, 30],
              [1, 30],
              [1, 31],
              [181, 30],
            ],
          ],
        },
      }),
    ).toBe(false);
  });
});
