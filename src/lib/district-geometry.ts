import type { CoverageGeometry, CoveragePosition } from "./coverage-types";

export type CoveragePoint = { lat: number; lng: number };
type RingResult = "outside" | "inside" | "boundary";

const EPSILON = 1e-10;

function pointOnSegment(
  point: CoveragePosition,
  start: CoveragePosition,
  end: CoveragePosition,
): boolean {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  const scale = Math.max(
    1,
    Math.abs(x),
    Math.abs(y),
    Math.abs(x1),
    Math.abs(y1),
    Math.abs(x2),
    Math.abs(y2),
  );
  if (Math.abs(cross) > EPSILON * scale) return false;
  return (
    x >= Math.min(x1, x2) - EPSILON &&
    x <= Math.max(x1, x2) + EPSILON &&
    y >= Math.min(y1, y2) - EPSILON &&
    y <= Math.max(y1, y2) + EPSILON
  );
}

function pointInRing(
  point: CoveragePosition,
  ring: CoveragePosition[],
): RingResult {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(point, start, end)) return "boundary";
    const crosses =
      start[1] > point[1] !== end[1] > point[1] &&
      point[0] <
        ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) +
          start[0];
    if (crosses) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function pointInPolygon(
  point: CoveragePosition,
  rings: CoveragePosition[][],
): boolean {
  const exterior = pointInRing(point, rings[0]);
  if (exterior === "outside") return false;
  if (exterior === "boundary") return true;
  for (const hole of rings.slice(1)) {
    const result = pointInRing(point, hole);
    if (result === "boundary") return true;
    if (result === "inside") return false;
  }
  return true;
}

/** Tests a WGS 84 latitude/longitude point against GeoJSON polygon coverage. */
export function pointInCoverage(
  point: CoveragePoint,
  geometry: CoverageGeometry,
): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  const coordinate: CoveragePosition = [point.lng, point.lat];
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(coordinate, polygon));
}
