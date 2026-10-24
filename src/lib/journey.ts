import { productionData } from "../data/coverage";
import staticGTFS from "../data/btd-timetable.json";
import { PublishedTimetableProvider } from "./transit";
import {
  formatTime,
  hasChicagoClockChange,
  parseTime,
  shiftDate,
} from "./time";
import type { SourceRef, TransitJourney } from "./types";

export type Coordinates = { lat: number; lng: number };
export type TravelMode = "walking" | "transit" | "driving";
export type ScheduledJourneyResult =
  | {
      status: "scheduled";
      message: string;
      journey: TransitJourney;
      date: string;
      sources: SourceRef[];
    }
  | {
      status: "unavailable";
      message: string;
      journey?: never;
      date?: string;
      sources?: SourceRef[];
    };

export function validCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as Partial<Coordinates>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function googleMapsUrl(
  origin: Coordinates,
  destination: Coordinates,
  mode: TravelMode,
): string {
  if (!validCoordinates(origin) || !validCoordinates(destination))
    throw new RangeError(
      "Directions require valid origin and destination coordinates.",
    );
  if (!["walking", "transit", "driving"].includes(mode))
    throw new RangeError("Unsupported travel mode.");
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Convert an instant, including DST, without relying on the device timezone. */
export function chicagoNow(instant: Date): { date: string; time: string } {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()))
    throw new RangeError("A valid current instant is required.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * Static timetable departures today, exclusively between published stop points.
 * Coordinate tolerance covers decimal precision, not a pedestrian connection.
 */
export function nextScheduledJourney(
  origin: Coordinates,
  destination: Coordinates,
  now: Date,
): ScheduledJourneyResult {
  if (!validCoordinates(origin) || !validCoordinates(destination))
    return {
      status: "unavailable",
      message: "Enter valid coordinates for both trip endpoints.",
    };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    return {
      status: "unavailable",
      message:
        "The current time could not be determined. Retry with a valid device clock.",
    };

  const { date, time } = chicagoNow(now);
  const unavailable = (message: string): ScheduledJourneyResult => ({
    status: "unavailable",
    message,
    date,
    sources: productionData.transit.sources,
  });
  const matchStop = (point: Coordinates) =>
    staticGTFS.stops.find(
      (stop) =>
        Math.abs(stop.lat - point.lat) <= 0.00001 &&
        Math.abs(stop.lon - point.lng) <= 0.00001,
    );
  const from = matchStop(origin);
  const to = matchStop(destination);
  if (!from || !to)
    return unavailable(
      "A scheduled route is available only between the published BTD stop coordinates. Walking connections from these locations have not been reviewed; open directions for other journeys.",
    );
  if (from.id === to.id)
    return unavailable(
      "Both locations match the same BTD stop; no transit journey is needed.",
    );

  const provider = new PublishedTimetableProvider(productionData.transit);
  if (!provider.isValid(date))
    return unavailable(
      `The published BTD timetable covers ${productionData.transit.validFrom} through ${productionData.transit.validTo}; there is no validated schedule for today.`,
    );
  if (hasChicagoClockChange(date))
    return unavailable(
      "Chicago's clock changes today. The static timetable cannot establish an unambiguous departure; confirm service with BTD.",
    );

  // Whole-minute departures must leave the full two minutes even at xx:xx:59.
  const earliest =
    parseTime(time) +
    2 +
    (now.getUTCSeconds() || now.getUTCMilliseconds() ? 1 : 0);
  const journey = provider
    .journeys(date, from.id, to.id, earliest, 2879)
    .filter((candidate) => candidate.departure < 1440)
    .sort((a, b) => a.departure - b.departure || a.arrival - b.arrival)[0];
  if (!journey)
    return unavailable(
      "No scheduled BTD journey remains today with a two-minute boarding buffer. Weekends, published holiday closures, and the last departure are included; these are static schedules, not live arrivals.",
    );
  if (journey.arrival >= 1440 && hasChicagoClockChange(shiftDate(date, 1)))
    return unavailable(
      "This journey crosses a Chicago clock change. Confirm its times with BTD before traveling.",
    );

  const sourceIds = new Set(
    journey.segments.flatMap((segment) => segment.sourceIds ?? []),
  );
  return {
    status: "scheduled",
    message: `Published BTD departure ${formatTime(journey.departure)}. The two-minute boarding buffer is an app planning assumption. This is a static timetable, not live arrivals. ${productionData.transit.uncertainties?.join(" ") ?? "Confirm service with BTD before traveling."}`,
    journey,
    date,
    sources: productionData.transit.sources.filter((source) =>
      sourceIds.has(source.id),
    ),
  };
}
