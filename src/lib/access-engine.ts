import type {
  AccessInput,
  AccessJourney,
  AccessOption,
  AccessResponse,
  AccessAvailability,
} from "./access-types";
import type { Resource } from "../data/resources";
import type { Pantry, PantryWindow } from "./types";
import { chicagoNow } from "./journey";
import { matchesRule } from "./recurrence";
import { isDate, parseTime, shiftDate } from "./time";
import { chicagoWallInstant } from "./access-time";

export type AccessCandidate = {
  resource: Resource;
  pantry: Pantry;
  availability: AccessAvailability;
  kind?: "pantry" | "household";
  navigationWarnings?: string[];
};
export type JourneyLookup = (
  from: AccessInput["origin"],
  to: AccessInput["origin"],
  earliest: number,
  latest: number,
) => Promise<AccessJourney[]>;
/** Ranking points, never a success probability. Unknown costs do not become zero. */
export const ACCESS_WEIGHTS = {
  travelMinute: 1,
  walkingMinute: 2,
  dollar: 4,
  transfer: 8,
  uncertainty: 12,
  closingSlackMinute: 0.1,
  waitingMinute: 0,
  timeToServiceMinute: 0,
};
const unique = (xs: string[]) => [...new Set(xs)];

export function validateAccessInput(
  input: AccessInput,
  now = new Date(),
): string[] {
  const errors: string[] = [];
  const local = chicagoNow(now);
  if (!isDate(input.date) || input.date < local.date)
    errors.push("Choose today or a future date in America/Chicago.");
  try {
    const departure = parseTime(input.departure);
    if (
      input.arrivalDeadline &&
      parseTime(input.arrivalDeadline, true) < departure
    )
      errors.push("The arrival deadline must follow departure.");
    if (input.returnTo && !input.returnDeadline)
      errors.push("Choose a return deadline.");
    if (
      input.returnDeadline &&
      parseTime(input.returnDeadline, true) <= departure
    )
      errors.push(
        "The return deadline must follow departure; use 24:00–47:59 for the next day.",
      );
  } catch {
    errors.push("Use valid local departure and deadline times.");
  }
  return errors;
}
function windowTimes(window: PantryWindow, offset: number) {
  return {
    open: parseTime(window.opens) + offset,
    close: parseTime(window.closes) + offset,
    registrationOpen:
      parseTime(window.registrationOpens || window.opens) + offset,
    registrationCutoff:
      parseTime(
        window.registrationCutoff || window.distributionCutoff || window.closes,
      ) + offset,
    distributionCutoff:
      parseTime(window.distributionCutoff || window.closes) + offset,
  };
}
export function freshAvailability(
  value: AccessAvailability,
  now: Date,
): AccessAvailability {
  if (
    !value.reportedAt ||
    !value.expiresAt ||
    !Number.isFinite(Date.parse(value.reportedAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.reportedAt) > +now ||
    Date.parse(value.expiresAt) <= +now
  )
    return {
      status: "unknown",
      source: "No current availability report",
      reportedAt: null,
      expiresAt: null,
    };
  return value;
}
function travelFailures(
  out: AccessJourney,
  back: AccessJourney | null,
  input: AccessInput,
): string[] {
  const failures: string[] = [];
  const minutes = out.walkingMinutes + (back?.walkingMinutes || 0),
    miles = out.walkingMiles + (back?.walkingMiles || 0);
  if (minutes > input.maxWalkingMinutes + 0.001)
    failures.push("The complete trip exceeds your walking-time limit.");
  if (miles > input.maxWalkingMiles + 0.001)
    failures.push("The complete trip exceeds your walking-distance limit.");
  if (
    out.transfers > input.maxTransfers ||
    (back && back.transfers > input.maxTransfers)
  )
    failures.push("This trip needs more transfers than allowed.");
  if ((out.fare ?? 0) + (back?.fare ?? 0) > input.fareBudget)
    failures.push("The complete trip exceeds your fare budget.");
  if (
    input.arrivalDeadline &&
    out.arrival > parseTime(input.arrivalDeadline, true)
  )
    failures.push("Arrival is after your deadline.");
  if (
    back &&
    input.returnDeadline &&
    back.arrival > parseTime(input.returnDeadline, true)
  )
    failures.push("The return trip misses your deadline.");
  return failures;
}
/** Deterministic evaluator. External geometry/times enter solely through JourneyLookup. */
export async function evaluateAccess(
  input: AccessInput,
  candidates: AccessCandidate[],
  lookup: JourneyLookup,
  now = new Date(),
  weights = ACCESS_WEIGHTS,
): Promise<AccessResponse> {
  const errors = validateAccessInput(input, now);
  if (errors.length) throw new RangeError(errors.join(" "));
  const local = chicagoNow(now);
  const earliest = Math.max(
    parseTime(input.departure),
    input.date === local.date
      ? parseTime(local.time) +
          (now.getUTCSeconds() || now.getUTCMilliseconds() ? 1 : 0)
      : 0,
  );
  const latest = input.returnDeadline
    ? parseTime(input.returnDeadline, true)
    : input.arrivalDeadline
      ? parseTime(input.arrivalDeadline, true)
      : 1439;
  const options: AccessOption[] = [];
  for (const candidate of candidates) {
    const { resource, pantry } = candidate;
    const departureInstant = chicagoWallInstant(input.date, input.departure);
    const availability = freshAvailability(
      candidate.availability,
      departureInstant && +departureInstant > +now ? departureInstant : now,
    );
    const warnings: string[] = [...(candidate.navigationWarnings || [])];
    const base: AccessOption = {
      id: resource.id,
      kind: candidate.kind || "pantry",
      resource,
      status: "confirm",
      reasons: [],
      warnings,
      labels: [],
      availability,
      outbound: null,
      returnJourney: null,
      serviceStart: null,
      serviceEnd: null,
      intakeCutoff: null,
      score: -10000,
    };
    if (
      resource.verificationStatus !== "confirmed-site" ||
      resource.detailsNeedConfirmation
    )
      warnings.push("Site details need confirmation.");
    if (!input.eligibilityConfirmed)
      warnings.push(
        "Eligibility, service-area and document requirements have not been confirmed for you.",
      );
    if (input.dietaryRequired)
      warnings.push(
        "Your dietary requirement has not been verified with this food source.",
      );
    if (input.mobility === "step-free")
      warnings.push(
        "Step-free paths, entrances and vehicle boarding have not been verified.",
      );
    if (availability.status === "unknown")
      warnings.push("Food availability is unknown or its report has expired.");
    else
      warnings.push(
        "Food availability is a dated report, not a guarantee of stock at arrival.",
      );
    if (
      input.mode !== "driving" &&
      (pantry.pedestrianPickup === "unknown" || !pantry.pedestrianPickup)
    )
      warnings.push("Pedestrian pickup permission is not verified.");
    if (input.mode !== "driving" && pantry.pedestrianPickup === "not-allowed") {
      options.push({
        ...base,
        status: "no",
        reasons: ["Published policy does not allow pedestrian pickup."],
      });
      continue;
    }
    const windows = [0, 1]
      .flatMap((day) => {
        const date = shiftDate(input.date, day);
        if (pantry.closures?.includes(date)) return [];
        return pantry.windows
          .filter((w) => matchesRule(w.rule, date))
          .map((window) => ({ window, ...windowTimes(window, day * 1440) }));
      })
      .filter((w) => w.close >= earliest && w.open <= latest);
    if (pantry.windows.length && !windows.length) {
      options.push({
        ...base,
        status: "no",
        reasons: [
          "No published distribution window fits the selected date and travel horizon.",
        ],
      });
      continue;
    }
    let outbound: AccessJourney[] = [];
    if (resource.coordinates)
      outbound = await lookup(
        input.origin,
        resource.coordinates,
        earliest,
        latest,
      );
    if (!outbound.length) {
      options.push({
        ...base,
        reasons: [
          "No verified itinerary was retrieved from this starting point. Check official service or calculate directions externally.",
        ],
        warnings: unique([
          ...warnings,
          "Route availability does not establish pantry eligibility or inventory.",
        ]),
      });
      continue;
    }
    const choices: AccessOption[] = [],
      failures: string[] = [];
    for (const out of outbound) {
      const hardTravel = travelFailures(out, null, input);
      if (hardTravel.length) {
        failures.push(...hardTravel);
        continue;
      }
      const arrivalInstant = chicagoWallInstant(
        input.date,
        `${String(Math.floor(out.arrival / 60)).padStart(2, "0")}:${String(out.arrival % 60).padStart(2, "0")}`,
      );
      if (
        arrivalInstant &&
        freshAvailability(candidate.availability, arrivalInstant).status ===
          "unavailable"
      ) {
        failures.push(
          "A current report says food is unavailable at the expected arrival.",
        );
        continue;
      }
      // A route is still useful when a distribution window is missing, but never fits.
      if (!windows.length) {
        choices.push({
          ...base,
          outbound: out,
          reasons: ["Distribution hours and intake cutoff are not verified."],
          warnings: unique([...warnings, ...out.warnings]),
        });
        continue;
      }
      for (const w of windows) {
        if (
          w.window.appointmentRequired &&
          input.appointment === "not-booked"
        ) {
          failures.push("An appointment is required and has not been booked.");
          continue;
        }
        const registration = Math.max(
          out.arrival + input.arrivalBufferMinutes,
          w.registrationOpen,
        );
        const start = Math.max(registration, w.open),
          end = start + input.visitMinutes;
        if (
          !input.allowWaiting &&
          start > out.arrival + input.arrivalBufferMinutes
        ) {
          failures.push("This option requires waiting for a later opening.");
          continue;
        }
        if (
          registration > w.registrationCutoff ||
          start > w.distributionCutoff ||
          end > w.close
        ) {
          failures.push(
            "You cannot arrive, complete intake and finish the visit before the published cutoff.",
          );
          continue;
        }
        if (input.returnTo && end > latest) {
          failures.push(
            "The visit finishes after your required return deadline.",
          );
          continue;
        }
        const returns =
          input.returnTo && resource.coordinates
            ? await lookup(resource.coordinates, input.returnTo, end, latest)
            : [];
        if (input.returnTo && !returns.length) {
          failures.push(
            "No return itinerary was retrieved after the visit. Return feasibility is unconfirmed.",
          );
          choices.push({
            ...base,
            outbound: out,
            serviceStart: start,
            serviceEnd: end,
            intakeCutoff: w.registrationCutoff,
            reasons: [
              "Your requested return journey is unavailable; this is not a confirmed round trip.",
            ],
            warnings: unique([...warnings, ...out.warnings]),
          });
          continue;
        }
        for (const back of input.returnTo ? returns : [null]) {
          const hard = travelFailures(out, back, input);
          if (hard.length) {
            failures.push(...hard);
            continue;
          }
          const unknowns = [
            ...warnings.filter(
              (v) => !v.startsWith("Food availability is a dated"),
            ),
            ...out.warnings,
            ...(back?.warnings || []),
          ];
          const serviceInstant = chicagoWallInstant(
            input.date,
            `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
          );
          const serviceAvailability = serviceInstant
            ? freshAvailability(candidate.availability, serviceInstant)
            : {
                status: "unknown" as const,
                source: "Service time is ambiguous",
                reportedAt: null,
                expiresAt: null,
              };
          if (serviceAvailability.status === "unavailable") {
            failures.push(
              "A current report says food is unavailable at the expected service time.",
            );
            continue;
          }
          if (serviceAvailability.status === "unknown")
            unknowns.push(
              "Availability is not confirmed for the expected service time.",
            );
          if (!w.window.policyKnown || w.window.conflictingSources)
            unknowns.push(
              "Published pickup policy or schedule requires confirmation.",
            );
          if (w.window.appointmentRequired && input.appointment !== "booked")
            unknowns.push("Your appointment has not been confirmed.");
          if (out.fare === null || back?.fare === null)
            unknowns.push(
              input.mode === "driving"
                ? "Fuel, parking and other driving costs are unknown, so your budget cannot be confirmed."
                : "The fare is unknown, so your budget cannot be confirmed.",
            );
          const travel =
              out.arrival -
              out.departure +
              (back ? back.arrival - back.departure : 0),
            walking = out.walkingMinutes + (back?.walkingMinutes || 0);
          const farePenalty =
            (out.fare ?? input.fareBudget + 1) +
            (back ? (back.fare ?? input.fareBudget + 1) : 0);
          const score =
            -(
              travel * weights.travelMinute +
              Math.max(0, start - earliest) * weights.timeToServiceMinute +
              Math.max(0, start - out.arrival) * weights.waitingMinute +
              walking * weights.walkingMinute +
              farePenalty * weights.dollar +
              (out.transfers + (back?.transfers || 0)) * weights.transfer +
              unique(unknowns).length * weights.uncertainty
            ) +
            Math.min(120, w.registrationCutoff - registration) *
              weights.closingSlackMinute;
          choices.push({
            ...base,
            availability: serviceAvailability,
            status: unknowns.length ? "confirm" : "fits",
            outbound: out,
            returnJourney: back,
            serviceStart: start,
            serviceEnd: end,
            intakeCutoff: w.registrationCutoff,
            score,
            reasons: [
              unknowns.length
                ? "A route fits the checked timing limits; the listed information still needs confirmation."
                : "Meets your stated constraints using the available route and service data.",
            ],
            warnings: unique([...warnings, ...unknowns]),
            labels: [
              ...(out.fare === 0 && (!back || back.fare === 0)
                ? ["No travel fare"]
                : []),
              ...(input.mode !== "driving" && walking <= 15
                ? ["Less walking"]
                : []),
              ...(w.registrationCutoff - registration >= 30
                ? ["More time before intake closes"]
                : []),
            ],
          });
        }
      }
    }
    const statusOrder = { fits: 0, confirm: 1, no: 2 };
    choices.sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] || b.score - a.score,
    );
    options.push(
      choices[0] || {
        ...base,
        status: "no",
        reasons: unique(
          failures.length
            ? failures
            : ["No itinerary meets the known requirements."],
        ),
        outbound: outbound[0],
      },
    );
  }
  const rank = { fits: 0, confirm: 1, no: 2 };
  options.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      Number(Boolean(b.outbound)) - Number(Boolean(a.outbound)) ||
      b.score - a.score ||
      a.resource.name.localeCompare(b.resource.name),
  );
  return {
    timezone: "America/Chicago",
    options,
    searchedAt: now.toISOString(),
    routingCalls: 0,
    aiCalls: 0,
    message:
      "Only retrieved routes establish travel estimates. Pantry reports and scheduled buses are not live guarantees. BTD coverage is limited; regional listings are incomplete.",
  };
}
