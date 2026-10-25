import type { AccessInput } from "./access-types";
import { chicagoNow, type Coordinates, type TravelMode } from "./journey";
import type { AccessOption } from "./access-types";
import { chicagoWallInstant } from "./access-time";
export type CheckedFoodTrip = {
  option: AccessOption;
  date: string;
  checkedAt: string;
  assumptions: string[];
  clockOffsetMs?: number;
};

/** A stored calculation must not remain a current departure recommendation. */
export function foodTripIsFresh(
  result: {
    searchedAt: string;
    options: AccessOption[];
    recommendation?: { selectedId: string | null };
    planningDate?: string;
  },
  now: Date,
): boolean {
  if (!Number.isFinite(+now)) return false;
  const checked = Date.parse(result.searchedAt);
  if (!Number.isFinite(checked) || checked > +now || +now - checked >= 60_000)
    return false;
  const selected = result.options.find(
    (option) => option.id === result.recommendation?.selectedId,
  );
  if (selected?.outbound?.source === "scheduled") {
    if (!result.planningDate) return false;
    const minute = selected.outbound.departure;
    const departure = chicagoWallInstant(
      result.planningDate,
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`,
    );
    if (!departure || +departure < +now) return false;
  }
  return true;
}

/** Visible prototype planning assumptions, not claims about the person's needs. */
export function foodTripInput(
  origin: Coordinates,
  mode: TravelMode,
  text: string,
  now = new Date(),
): { input: AccessInput; assumptions: string[]; clarification?: string } {
  const local = chicagoNow(now);
  const request = text.toLowerCase().replace(/’/g, "'");
  let clarification: string | undefined;
  const input: AccessInput = {
    origin: { ...origin },
    date: local.date,
    departure: local.time,
    mode,
    maxWalkingMinutes: 20,
    maxWalkingMiles: 1,
    fareBudget: 5,
    maxTransfers: 2,
    mobility: "standard",
    appointment: "unknown",
    eligibilityConfirmed: false,
    dietaryPreference: "none",
    dietaryRequired: false,
    visitMinutes: 30,
    arrivalBufferMinutes: 15,
    allowWaiting: !/\b(?:right now|open now|cannot wait|can't wait)\b/.test(
      request,
    ),
  };
  const assumptions = [
    "Leaving now, using Central time.",
    "Planning a 30-minute visit with a 15-minute arrival buffer.",
  ];
  const mileMatch = request.match(
    /\bwalk(?:ing)?\b[^!?;\n]{0,40}?(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|half|quarter|\d+(?:\.\d+)?|\.\d+)\s*(?:a\s+)?miles?\b/,
  );
  if (mileMatch) {
    const fraction = mileMatch[1].match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
    const miles = fraction
      ? Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3])
      : mileMatch[1] === "half"
        ? 0.5
        : mileMatch[1] === "quarter"
          ? 0.25
          : Number(mileMatch[1]);
    if (Number.isFinite(miles) && miles >= 0 && miles <= 20)
      input.maxWalkingMiles = miles;
    else
      clarification =
        "How far can you walk? Use a distance such as ‘half a mile’ or ‘0.5 miles’. That limit has not been checked yet.";
  }
  const minutesMatch = request.match(
    /\bwalk(?:ing)?\b[^.!?]{0,40}?\b(\d+)\s*(?:minutes?|mins?)\b/,
  );
  if (
    /\bwalk(?:ing)?\b[^!?;\n]{0,40}?\d+\s*\/\s*\d+\s*(?:minutes?|mins?)\b/.test(
      request,
    )
  )
    clarification =
      "Please give your walking-time limit in whole minutes, or use a distance such as ‘half a mile’. That limit has not been checked yet.";
  if (minutesMatch && Number(minutesMatch[1]) <= 180)
    input.maxWalkingMinutes = Number(minutesMatch[1]);
  if (
    /\b(?:cannot|can't|unable to)\s+walk\b(?!\s+(?:more|over|for|far|long|to|that|very|much|without|a|an)\b|\s+\d)/.test(
      request,
    )
  ) {
    input.maxWalkingMinutes = 0;
    input.maxWalkingMiles = 0;
  }
  const fare = request.match(
    /\b(?:budget|fare|spend|afford)[^.!?]{0,15}\$\s*(\d+(?:\.\d{1,2})?)/,
  );
  if (fare && Number(fare[1]) <= 100) input.fareBudget = Number(fare[1]);
  if (
    /\b(?:no money|no (?:bus )?fare|cannot afford (?:the |a )?bus|can't afford (?:the |a )?bus|no budget)\b/.test(
      request,
    )
  )
    input.fareBudget = 0;
  if (
    !mileMatch &&
    !minutesMatch &&
    /\b(?:cannot|can't|unable to)\s+walk\s+(?:far|long)|\bshort distances only\b/.test(
      request,
    )
  )
    clarification =
      "How far or how many minutes can you walk? For example, ‘I can walk half a mile’. A trip within your limit has not been checked yet.";
  if (/\b(?:no transfers|cannot transfer|can't transfer)\b/.test(request))
    input.maxTransfers = 0;
  if (
    /\b(?:no appointments?|without (?:an )?appointment|don't have an appointment|do not have an appointment|(?:don't|do not|doesn't|does not) (?:need|require) (?:an? )?appointments?)\b/.test(
      request,
    )
  )
    input.appointment = "not-booked";
  if (/\b(?:wheelchair|step.free)\b/.test(request))
    input.mobility = "step-free";
  for (const diet of [
    "halal",
    "kosher",
    "vegan",
    "vegetarian",
    "gluten-free",
    "dairy-free",
    "nut-free",
  ]) {
    if (request.includes(diet)) {
      input.dietaryPreference = diet;
      input.dietaryRequired = true;
      break;
    }
  }
  const returnPrefix =
    /\b(?:back|return(?:\s+home)?|home)\s+(?:by|before|at|around)\s+/;
  const back = request.match(
    new RegExp(
      returnPrefix.source + "(\\d{1,2})(?::([0-5]\\d))?\\s*(am|pm)\\b",
    ),
  );
  const back24 = request.match(
    new RegExp(
      returnPrefix.source + "([01]?\\d|2[0-3]):([0-5]\\d)\\b(?!\\s*(?:am|pm))",
    ),
  );
  if ((back && Number(back[1]) >= 1 && Number(back[1]) <= 12) || back24) {
    const hour = back
      ? (Number(back[1]) % 12) + (back[3] === "pm" ? 12 : 0)
      : Number(back24![1]);
    input.returnTo = { ...origin };
    input.returnDeadline = `${String(hour).padStart(2, "0")}:${(back ?? back24)![2] ?? "00"}`;
    assumptions.push(
      `Return to the same starting point by ${input.returnDeadline} today. An already-passed deadline is not shifted to tomorrow.`,
    );
  } else if (
    /\b(?:return|round[ -]?trip|both ways|there and back|get back|back (?:by|before|at)|home (?:by|before|at))\b/.test(
      request,
    )
  ) {
    clarification =
      "What time do you need to be back? Include am or pm, for example ‘back by 4pm’. A return trip has not been checked.";
    assumptions.push(
      "Return time was unclear. Return feasibility is not checked; use a time such as ‘back by 4pm’ or the detailed controls.",
    );
  } else
    assumptions.push("One-way trip only; no return deadline was supplied.");
  assumptions.push(
    `Walking limit: ${input.maxWalkingMiles} mile(s) and ${input.maxWalkingMinutes} minutes across the trip. Fare budget: $${input.fareBudget}; at most ${input.maxTransfers} transfers. You can change these in your request or detailed controls.`,
  );
  assumptions.push(
    "Appointment and eligibility are not assumed confirmed. Food stock, step-free access and pedestrian pickup may need confirmation.",
  );
  if (
    /\b(?:tomorrow|next week|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b20\d{2}-\d{2}-\d{2}\b|\b(?:leave|leaving|depart|departure)\s+(?:at\s+)?\d/.test(
      request,
    )
  )
    clarification =
      "This quick check leaves now. For another departure day or time, open Step-by-step trip controls so Reach can check the correct service date. No trip for that requested time has been confirmed.";
  return { input, assumptions, ...(clarification ? { clarification } : {}) };
}
