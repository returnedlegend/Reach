import { productionData } from "../data/coverage";
import { transitStops } from "../data/resources";
import type { AccessInput, AccessJourney } from "./access-types";
import { computeOsmJourney, type JourneyResult } from "./osm-services";
import { PublishedTimetableProvider } from "./transit";
import { transitPaths } from "./transit-paths";
import { formatTime, hasChicagoClockChange, shiftDate } from "./time";
import type { MapCoordinates } from "./map-types";
import type { PublishedTimetable } from "./types";

/** Shortlisting only: never labeled as a walking route or used for feasibility. */
export function shortlistMiles(a: MapCoordinates, b: MapCoordinates): number {
  const radians = (v: number) => (v * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat),
    dLng = radians(b.lng - a.lng);
  return (
    3958.7613 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dLat / 2) ** 2 +
            Math.cos(radians(a.lat)) *
              Math.cos(radians(b.lat)) *
              Math.sin(dLng / 2) ** 2,
        ),
      ),
    )
  );
}
export type WalkingLookup = (
  from: MapCoordinates,
  to: MapCoordinates,
) => Promise<JourneyResult>;

/** Reuse the published GTFS router; only routed walking legs connect actual coordinates. */
export async function scheduledAccessJourneys(
  input: AccessInput,
  from: MapCoordinates,
  to: MapCoordinates,
  earliest: number,
  latest: number,
  walking: WalkingLookup,
  timetable = productionData.transit,
  stops = transitStops,
): Promise<AccessJourney[]> {
  const provider = new PublishedTimetableProvider(timetable);
  if (
    !provider.isValid(input.date) ||
    hasChicagoClockChange(input.date) ||
    (latest >= 1440 && hasChicagoClockChange(shiftDate(input.date, 1)))
  )
    return [];
  const nearest = (point: MapCoordinates) =>
    [...stops]
      .sort((a, b) => shortlistMiles(point, a) - shortlistMiles(point, b))
      .slice(0, 2);
  const results: AccessJourney[] = [];
  for (const board of nearest(from)) {
    const first = await walking(from, board);
    if (first.status !== "available") continue;
    for (const alight of nearest(to)) {
      if (board.id === alight.id) continue;
      const last = await walking(alight, to);
      if (last.status !== "available") continue;
      const walkMinutes =
        Math.ceil(first.durationMinutes) + Math.ceil(last.durationMinutes);
      const walkMiles = first.distanceMiles + last.distanceMiles;
      if (
        walkMinutes > input.maxWalkingMinutes ||
        walkMiles > input.maxWalkingMiles
      )
        continue;
      for (const offset of [0, 1]) {
        const date = shiftDate(input.date, offset);
        if (!provider.isValid(date)) continue;
        const boardAfter = Math.max(
          0,
          earliest + Math.ceil(first.durationMinutes) + 2 - offset * 1440,
        );
        const busLatest =
          latest - Math.ceil(last.durationMinutes) - offset * 1440;
        for (const trip of provider.journeys(
          date,
          board.id,
          alight.id,
          boardAfter,
          busLatest,
        )) {
          const segments = trip.segments.map((s) => ({
            ...s,
            start: s.start + offset * 1440,
            end: s.end + offset * 1440,
          }));
          const buses = segments.filter((s) => s.kind === "bus");
          if (!buses.length || buses.length - 1 > input.maxTransfers) continue;
          const departure =
            trip.departure +
            offset * 1440 -
            Math.ceil(first.durationMinutes) -
            2;
          const arrival =
            trip.arrival + offset * 1440 + Math.ceil(last.durationMinutes);
          if (departure < earliest || arrival > latest) continue;
          results.push({
            departure,
            arrival,
            walkingMinutes: walkMinutes,
            walkingMiles: walkMiles,
            fare:
              timetable === productionData.transit && buses.length === 1
                ? 1
                : null,
            transfers: buses.length - 1,
            source: "scheduled",
            paths: [
              ...first.paths.map((p) => ({ ...p, id: `to-stop-${p.id}` })),
              ...transitPaths(segments),
              ...last.paths.map((p) => ({ ...p, id: `from-stop-${p.id}` })),
            ],
            attribution: [
              ...first.attribution,
              ...(timetable === productionData.transit
                ? [
                    {
                      label:
                        "BTD Route 00 GTFS; snapshot 2026-10-15, route data rechecked 2026-10-22",
                      url: "https://www.btd.org/2025btdgtfs/",
                    },
                    {
                      label:
                        "BTD general-public $1 one-way cash fare; checked 2026-10-22",
                      url: "https://www.btd.org/fixed-routes/rates/",
                    },
                  ]
                : []),
            ],
            warnings: [
              ...(timetable.uncertainties || []),
              "Scheduled service; not live. Accessible boarding and pedestrian entrances need confirmation. A two-minute boarding and published minimum transfer buffer are planning assumptions.",
              ...(timetable === productionData.transit
                ? [
                    "Current publisher and bundled feed version metadata conflict, but Route 00 trips, times, stops, calendar and shapes were unchanged on recheck. The published PDF timetable still disagrees; confirm with BTD.",
                    buses.length === 1
                      ? "Uses the published $1 general-public one-way cash fare. Discounts require proof and are not assumed."
                      : "Transfer fares are not verified; the total fare remains unknown.",
                  ]
                : []),
            ],
            steps: [
              ...first.steps.map((s) => s.instruction),
              `Board at ${board.name}; arrive two minutes before ${formatTime(trip.departure + offset * 1440)}.`,
              ...segments.map((s) =>
                s.kind === "bus"
                  ? `${s.route}: ${stops.find((v) => v.id === s.from)?.name || s.from} to ${stops.find((v) => v.id === s.to)?.name || s.to}, ${formatTime(s.start)}–${formatTime(s.end)} (scheduled).`
                  : `Wait until ${formatTime(s.end)} at the transfer stop.`,
              ),
              ...last.steps.map((s) => s.instruction),
            ],
          });
        }
      }
    }
  }
  const seen = new Set<string>();
  return results
    .sort(
      (a, b) => a.arrival - b.arrival || a.walkingMinutes - b.walkingMinutes,
    )
    .filter((r) => {
      const key = JSON.stringify([r.departure, r.arrival, r.steps]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

export function accessJourneyLookup(
  input: AccessInput,
  options: {
    signal?: AbortSignal;
    route?: typeof computeOsmJourney;
    timetable?: PublishedTimetable;
  } = {},
) {
  const memo = new Map<string, Promise<JourneyResult>>(),
    messages = new Set<string>();
  let calls = 0;
  const started = Date.now();
  const walking: WalkingLookup = (from, to) => {
    if (from.lat === to.lat && from.lng === to.lng)
      return Promise.resolve({
        status: "available",
        distanceMiles: 0,
        durationMinutes: 0,
        label: "Already at the exact selected point",
        steps: [],
        paths: [],
        attribution: [],
      });
    const key = JSON.stringify([from, to, "walking"]);
    const old = memo.get(key);
    if (old) return old;
    if (calls >= 12 || Date.now() - started > 25000 || options.signal?.aborted)
      return Promise.resolve({
        status: "unavailable",
        reason: "quota",
        message:
          "The route-check budget was reached. Select one destination to check it separately.",
      });
    calls++;
    const promise = (options.route || computeOsmJourney)({
      origin: from,
      destination: to,
      mode: "walking",
    }).then((r) => {
      if (r.status === "unavailable") messages.add(r.message);
      return r;
    });
    memo.set(key, promise);
    return promise;
  };
  const lookup = async (
    from: MapCoordinates,
    to: MapCoordinates,
    earliest: number,
    latest: number,
  ): Promise<AccessJourney[]> => {
    if (input.mode === "transit")
      return scheduledAccessJourneys(
        input,
        from,
        to,
        earliest,
        latest,
        walking,
        options.timetable,
      );
    const driving = input.mode === "driving";
    let route: JourneyResult;
    if (driving) {
      const key = JSON.stringify([from, to, "driving"]);
      let pending = memo.get(key);
      if (!pending) {
        if (
          calls >= 12 ||
          Date.now() - started > 25000 ||
          options.signal?.aborted
        )
          return [];
        calls++;
        pending = (options.route || computeOsmJourney)({
          origin: from,
          destination: to,
          mode: "driving",
        });
        memo.set(key, pending);
      }
      route = await pending;
      if (route.status === "unavailable") messages.add(route.message);
    } else route = await walking(from, to);
    if (route.status !== "available") return [];
    const minutes = Math.ceil(route.durationMinutes);
    return [
      {
        mode: input.mode,
        distanceMiles: route.distanceMiles,
        durationMinutes: minutes,
        departure: earliest,
        arrival: earliest + minutes,
        walkingMinutes: driving ? 0 : minutes,
        walkingMiles: driving ? 0 : route.distanceMiles,
        fare: driving ? null : 0,
        transfers: 0,
        source: "routed",
        paths: route.paths,
        attribution: route.attribution,
        steps: route.steps.map((s) => s.instruction),
        warnings: [
          driving
            ? "Driving time is a routing estimate. Fuel and parking costs, parking availability, loading time and walking from parking to pickup are unknown; driving arrival is not a verified arrival at the service entrance."
            : "Walking time is a routing estimate. Sidewalk safety, step-free access and pedestrian entrances are not verified.",
        ],
      },
    ];
  };
  return { lookup, calls: () => calls, messages: () => [...messages] };
}
