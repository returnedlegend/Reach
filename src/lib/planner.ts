import type {
  Pantry,
  PantryWindow,
  PlannerData,
  PlannerInput,
  PlanResult,
  Segment,
} from "./types";
import {
  hasChicagoClockChange,
  isDate,
  parseTime,
  shiftDate,
  weekday,
} from "./time";
import { matchesRule } from "./recurrence";
import { PublishedTimetableProvider } from "./transit";

export function validateInput(
  input: PlannerInput,
  data: PlannerData,
): string[] {
  const errors: string[] = [];
  if (!data.origins.some((o) => o.id === input.originId))
    errors.push("Choose a known starting location.");
  if (!isDate(input.date)) errors.push("Choose a valid local date.");
  if (!["bus", "walk"].includes(input.mode))
    errors.push("Choose bus or walk travel.");
  if (!["booked", "not-booked", "unknown"].includes(input.appointmentStatus))
    errors.push("Choose a valid appointment status.");
  try {
    if (parseTime(input.latestReturn) <= parseTime(input.earliestDeparture))
      errors.push("Return time must be after departure on the same day.");
  } catch {
    errors.push("Enter valid departure and return times.");
  }
  if (!Number.isFinite(input.maxWalkMiles) || input.maxWalkMiles < 0)
    errors.push("Walking distance must be zero or greater.");
  if (!Number.isFinite(input.visitMinutes) || input.visitMinutes <= 0)
    errors.push("Visit duration must be greater than zero.");
  if (
    input.arrivalBufferMinutes !== undefined &&
    (!Number.isFinite(input.arrivalBufferMinutes) ||
      input.arrivalBufferMinutes < 0)
  )
    errors.push("Arrival buffer must be zero or greater.");
  if (
    input.boardingBufferMinutes !== undefined &&
    (!Number.isFinite(input.boardingBufferMinutes) ||
      input.boardingBufferMinutes < 0)
  )
    errors.push("Boarding buffer must be zero or greater.");
  if (
    input.skipDepartures !== undefined &&
    (!Number.isInteger(input.skipDepartures) || input.skipDepartures < 0)
  )
    errors.push("Departure offset must be a nonnegative integer.");
  return errors;
}

const walk = (
  from: string,
  to: string,
  start: number,
  minutes: number,
  miles: number,
): Segment => ({ kind: "walk", from, to, start, end: start + minutes, miles });

export function planVisits(
  input: PlannerInput,
  data: PlannerData,
): PlanResult[] {
  const errors = validateInput(input, data);
  if (errors.length)
    return data.pantries.map((p) => ({
      pantryId: p.id,
      status: "no",
      reasons: errors,
      segments: [],
      sources: p.sources,
    }));
  const origin = data.origins.find((o) => o.id === input.originId)!;
  const earliest = parseTime(input.earliestDeparture),
    latest = parseTime(input.latestReturn);
  const buffer = input.arrivalBufferMinutes ?? 10;
  const provider = new PublishedTimetableProvider({
    ...data.transit,
    minTransferMinutes: Math.max(
      data.transit.minTransferMinutes,
      input.boardingBufferMinutes ?? 5,
    ),
  });
  return data.pantries.map((pantry) => {
    const base = {
      pantryId: pantry.id,
      segments: [] as Segment[],
      sources: [
        ...pantry.sources,
        ...(input.mode === "bus" ? data.transit.sources : []),
      ],
    };
    if (pantry.closures?.includes(input.date))
      return {
        ...base,
        status: "no",
        reasons: ["Pantry is closed on this date."],
      };
    if (input.mode === "bus" && !provider.isValid(input.date))
      return {
        ...base,
        status: "confirm",
        reasons: [
          "Transit timetable does not cover this date. Confirm current service.",
        ],
      };
    if (input.mode === "bus" && hasPublishedService(input.date, data) === false)
      return {
        ...base,
        status: "no",
        reasons: [
          "No published transit service operates on this date. The service calendar or holiday closure prevents a bus trip.",
        ],
      };
    const windows = pantry.windows.filter((w) =>
      matchesRule(w.rule, input.date),
    );
    if (!pantry.windows.length)
      return {
        ...base,
        status: "confirm",
        reasons: ["Pantry hours are missing. Confirm before traveling."],
      };
    if (!windows.length)
      return {
        ...base,
        status: "no",
        reasons: ["No published pantry window on this date."],
      };
    const candidates: PlanResult[] = [];
    const failures = new Set<string>();
    for (const window of windows) {
      if (
        window.appointmentRequired &&
        input.appointmentStatus === "not-booked"
      ) {
        failures.add("An appointment is required and has not been booked.");
        continue;
      }
      if (pantry.pedestrianPickup === "not-allowed") {
        failures.add(
          "Published pickup policy does not allow pedestrian access.",
        );
        continue;
      }
      const evaluate = (
        outbound: Segment[],
        arrival: number,
        walkingMiles: number,
        returnJourney: (after: number) => Segment[] | undefined,
      ) => {
        // Registration may happen before distribution begins. Waiting for food
        // must not incorrectly move a timely registration past its cutoff.
        const registered = Math.max(
          arrival + buffer,
          window.registrationOpens
            ? parseTime(window.registrationOpens)
            : window.registrationCutoff
              ? 0
              : parseTime(window.opens),
        );
        const ready = Math.max(registered, parseTime(window.opens));
        const cutoff = window.registrationCutoff
          ? parseTime(window.registrationCutoff)
          : parseTime(window.closes);
        if (registered > cutoff) {
          failures.add("Arrival plus buffer misses the registration cutoff.");
          return;
        }
        const leave = ready + input.visitMinutes;
        if (leave > parseTime(window.distributionCutoff ?? window.closes)) {
          failures.add(
            "There is not enough time to finish the visit before distribution closes.",
          );
          return;
        }
        const returning = returnJourney(leave);
        if (!returning || (returning.at(-1)?.end ?? leave) > latest) {
          failures.add(
            "Outbound travel works, but no return meets your deadline.",
          );
          return;
        }
        const reasons = [
          ...uncertainty(pantry, window, input),
          ...(input.mode === "bus" ? (data.transit.uncertainties ?? []) : []),
        ];
        if (
          hasChicagoClockChange(input.date) &&
          (outbound[0]?.start ?? arrival) < 180 &&
          (returning.at(-1)?.end ?? leave) > 60
        )
          reasons.push(
            "This overnight trip overlaps a daylight-saving clock change. Confirm exact travel and appointment times.",
          );
        const rides = [...outbound, ...returning].filter(
          (segment) => segment.kind === "bus",
        );
        if (
          rides.some(
            (ride) =>
              !ride.sourceIds?.length ||
              ride.sourceIds.some(
                (id) =>
                  !data.transit.sources.some((source) => source.id === id),
              ),
          )
        )
          reasons.push("Transit timetable source is missing.");
        const waiting: Segment[] =
          ready > arrival
            ? [
                {
                  kind: "wait",
                  from: pantry.id,
                  to: pantry.id,
                  start: arrival,
                  end: ready,
                },
              ]
            : [];
        candidates.push({
          ...base,
          status: reasons.length ? "confirm" : "fits",
          reasons: reasons.length
            ? reasons
            : [
                "Round trip fits the published window, arrival buffer, and walking budget.",
              ],
          windowId: window.id,
          arrival,
          returnAt: returning.at(-1)?.end ?? leave,
          walkingMiles,
          segments: [
            ...outbound,
            ...waiting,
            {
              kind: "visit",
              from: pantry.id,
              to: pantry.id,
              start: ready,
              end: leave,
            },
            ...returning,
          ],
        });
      };
      if (input.mode === "walk") {
        const connections = pantry.directWalks.filter(
          (c) => c.originId === origin.id && c.reviewed,
        );
        if (!connections.length) {
          failures.add("No reviewed walking route is available.");
          continue;
        }
        for (const c of connections) {
          if (c.miles * 2 > input.maxWalkMiles) {
            failures.add("Round-trip walking exceeds your limit.");
            continue;
          }
          evaluate(
            [walk(origin.id, pantry.id, earliest, c.minutes, c.miles)],
            earliest + c.minutes,
            c.miles * 2,
            (after) => [walk(pantry.id, origin.id, after, c.minutes, c.miles)],
          );
        }
      } else {
        const origins = origin.walkConnections.filter((c) => c.reviewed),
          accesses = pantry.walkConnections.filter((c) => c.reviewed);
        if (!origins.length || !accesses.length) {
          failures.add("A reviewed walk connection to transit is missing.");
          continue;
        }
        for (const a of origins)
          for (const b of accesses) {
            const miles = (a.miles + b.miles) * 2;
            const boarding =
              a.stopId === b.stopId ? 0 : (input.boardingBufferMinutes ?? 5);
            if (miles > input.maxWalkMiles) {
              failures.add("Round-trip walking exceeds your limit.");
              continue;
            }
            const outbound = provider
              .journeys(
                input.date,
                a.stopId,
                b.stopId,
                earliest + a.minutes + boarding,
                latest - b.minutes,
              )
              .sort(
                (x, y) => x.departure - y.departure || x.arrival - y.arrival,
              );
            const departures = [...new Set(outbound.map((j) => j.departure))];
            const threshold = departures[input.skipDepartures ?? 0];
            for (const journey of outbound.filter(
              (j) => threshold !== undefined && j.departure >= threshold,
            )) {
              evaluate(
                [
                  walk(
                    origin.id,
                    a.stopId,
                    journey.departure - a.minutes - boarding,
                    a.minutes,
                    a.miles,
                  ),
                  ...(boarding > 0
                    ? [
                        {
                          kind: "wait" as const,
                          from: a.stopId,
                          to: a.stopId,
                          start: journey.departure - boarding,
                          end: journey.departure,
                        },
                      ]
                    : []),
                  ...journey.segments,
                  walk(
                    b.stopId,
                    pantry.id,
                    journey.arrival,
                    b.minutes,
                    b.miles,
                  ),
                ],
                journey.arrival + b.minutes,
                miles,
                (after) => {
                  const back = provider.journeys(
                    input.date,
                    b.stopId,
                    a.stopId,
                    after + b.minutes + boarding,
                    latest - a.minutes,
                  )[0];
                  if (!back) return undefined;
                  return [
                    walk(pantry.id, b.stopId, after, b.minutes, b.miles),
                    ...(back.departure > after + b.minutes
                      ? [
                          {
                            kind: "wait" as const,
                            from: b.stopId,
                            to: b.stopId,
                            start: after + b.minutes,
                            end: back.departure,
                          },
                        ]
                      : []),
                    ...back.segments,
                    walk(a.stopId, origin.id, back.arrival, a.minutes, a.miles),
                  ];
                },
              );
            }
            if (!outbound.length || threshold === undefined)
              failures.add(
                "No published outbound departure is available for these constraints.",
              );
          }
      }
    }
    candidates.sort(
      (a, b) =>
        Number(a.status !== "fits") - Number(b.status !== "fits") ||
        (a.returnAt ?? Infinity) - (b.returnAt ?? Infinity),
    );
    if (candidates.length) return candidates[0];
    const missing = [...failures].some((r) => /missing|No reviewed/.test(r));
    return {
      ...base,
      windowId: windows[0]?.id,
      status: missing ? "confirm" : "no",
      reasons: [
        ...failures,
        ...(missing ? uncertainty(pantry, windows[0], input) : []),
        ...(input.mode === "bus" ? (data.transit.uncertainties ?? []) : []),
      ],
    };
  });
}

/** Unknown calendars are not proof of a service closure. Include after-midnight
 * departures from the previous service day before declaring no service. */
function hasPublishedService(
  date: string,
  data: PlannerData,
): boolean | undefined {
  if (
    !data.transit.trips.length ||
    data.transit.trips.some(
      (t) => !data.transit.calendars.some((c) => c.id === t.serviceId),
    )
  )
    return undefined;
  return [-1, 0].some((offset) => {
    const serviceDate = shiftDate(date, offset);
    if (
      serviceDate < data.transit.validFrom ||
      serviceDate > data.transit.validTo
    )
      return false;
    return data.transit.trips.some((trip) => {
      const calendar = data.transit.calendars.find(
        (c) => c.id === trip.serviceId,
      )!;
      const active =
        calendar.exceptions?.[serviceDate] ??
        (serviceDate >= calendar.startDate &&
          serviceDate <= calendar.endDate &&
          calendar.weekdays.includes(weekday(serviceDate)));
      return (
        active &&
        trip.stops.slice(0, -1).some((stop) => {
          const departure = parseTime(stop.departure, true) + offset * 1440;
          return departure >= 0 && departure < 1440;
        })
      );
    });
  });
}

function uncertainty(
  pantry: Pantry,
  window: PantryWindow,
  input: PlannerInput,
): string[] {
  const reasons: string[] = [];
  if (window.appointmentRequired === undefined)
    reasons.push(
      "Whether an appointment is required is unknown. Confirm with the provider.",
    );
  if (!window.policyKnown)
    reasons.push("Pickup or eligibility policy needs confirmation.");
  if (pantry.windows.some((w) => w.conflictingSources))
    reasons.push("Published sources conflict. Confirm hours before traveling.");
  if (window.appointmentRequired && input.appointmentStatus === "unknown")
    reasons.push("Confirm that you have the required appointment.");
  if (window.appointmentRequired && input.appointmentStatus === "booked")
    reasons.push(
      "A booked appointment still needs an exact time check; this estimate uses the general distribution window.",
    );
  if (
    window.registrationCutoff &&
    !window.registrationOpens &&
    parseTime(window.registrationCutoff) < parseTime(window.opens)
  )
    reasons.push(
      "Registration opening time is missing for this earlier cutoff.",
    );
  if (
    pantry.pickupFormat === "unknown" ||
    pantry.pedestrianPickup === "unknown"
  )
    reasons.push(
      "Pickup format or pedestrian access is unknown. Confirm before traveling.",
    );
  if (
    pantry.pickupFormat === "drive-through" &&
    pantry.pedestrianPickup !== "allowed"
  )
    reasons.push("Confirm pedestrian pickup at this drive-through location.");
  if (pantry.documents?.some((d) => d.requirement === "unknown"))
    reasons.push("Document requirements need confirmation.");
  if (pantry.missingInformation?.length)
    reasons.push(
      ...pantry.missingInformation.map((item) => `Confirm: ${item}`),
    );
  if (
    !window.sourceIds.length ||
    window.sourceIds.some((id) => !pantry.sources.some((s) => s.id === id))
  )
    reasons.push("Schedule source is missing.");
  return reasons;
}
