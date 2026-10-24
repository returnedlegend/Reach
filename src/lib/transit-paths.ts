import geometry from "../data/btd-shapes.json";
import type { MapPath } from "./map-types";
import type { Segment } from "./types";
type Point = [number, number, number];
/** Clip the agency's published shape by its GTFS distance values, not nearest-road guesses. */
export function transitPaths(segments: Segment[]): MapPath[] {
  const trips = geometry.trips as Record<
    string,
    { shapeId: string; stops: Record<string, number> }
  >;
  const shapes = geometry.shapes as Record<string, number[][]>;
  return segments.flatMap((segment, index) => {
    if (segment.kind !== "bus" || !segment.tripId) return [];
    const trip = trips[segment.tripId];
    if (!trip) return [];
    const start = trip.stops[segment.from],
      end = trip.stops[segment.to];
    const shape = shapes[trip.shapeId] as Point[] | undefined;
    if (
      !shape ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      start < shape[0][2] ||
      end > shape[shape.length - 1][2]
    )
      return [];
    const pointAt = (distance: number): [number, number] => {
      for (let i = 1; i < shape.length; i++) {
        const a = shape[i - 1],
          b = shape[i];
        if (b[2] >= distance) {
          const fraction =
            b[2] === a[2] ? 0 : (distance - a[2]) / (b[2] - a[2]);
          return [
            a[0] + fraction * (b[0] - a[0]),
            a[1] + fraction * (b[1] - a[1]),
          ];
        }
      }
      return [shape[shape.length - 1][0], shape[shape.length - 1][1]];
    };
    return [
      {
        id: `btd-${index}`,
        mode: "bus" as const,
        coordinates: [
          pointAt(start),
          ...shape
            .filter((p) => p[2] > start && p[2] < end)
            .map((p) => [p[0], p[1]] as [number, number]),
          pointAt(end),
        ],
        label: `${segment.route ?? "BTD"} published GTFS path; scheduled, not live`,
      },
    ];
  });
}
