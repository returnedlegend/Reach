import { z } from "zod";
import type { NavigationNeeds } from "./navigation-types";
import type { AccessCandidate } from "./access-engine";
import { CROWD_LEVELS, type BusySummary } from "./crowd-types";

/** Strict defaults for declared navigation preferences; these do not prove eligibility or stock. */
export const navigationNeedsSchema = z
  .object({
    service: z
      .enum(["food", "groceries", "prepared-meals", "shelter"])
      .default("food"),
    urgency: z.enum(["soon", "today", "flexible"]).default("today"),
    householdSize: z.number().int().min(1).max(20).optional(),
    hasIdentification: z.enum(["yes", "no", "unknown"]).default("unknown"),
    preferTransitNearby: z.boolean().default(false),
  })
  .strict() satisfies z.ZodType<NavigationNeeds>;

export type NavigationResourceCandidate = AccessCandidate & {
  navigationWarnings?: string[];
};

const SOURCE_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats historical observations only; it does not predict current conditions or affect ranking. */
export function navigationCrowdNote(
  summary: BusySummary | null,
  weekday: number,
  hour: number,
): string {
  const unavailable =
    "No sufficiently supported crowd pattern is available for the planned pickup hour.";
  if (
    !summary ||
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  )
    return unavailable;
  const slots = summary.days
    .filter((day) => day.weekday === weekday)
    .flatMap((day) => day.hours)
    .filter(
      (slot) =>
        slot.hour === hour &&
        slot.status === "observed" &&
        slot.level !== null &&
        slot.confidence !== null,
    );
  const slot = slots[0];
  if (
    !slot ||
    !Number.isInteger(slot.level) ||
    slot.level! < 0 ||
    slot.level! >= CROWD_LEVELS.length
  )
    return unavailable;

  const level = CROWD_LEVELS[slot.level!];
  const wait =
    slot.waitMinutes !== null &&
    Number.isFinite(slot.waitMinutes) &&
    slot.waitMinutes >= 0
      ? ` The historical average reported wait was ${slot.waitMinutes} minutes.`
      : "";
  return `Historical community observations describe ${level} crowding for this weekday and pickup hour with ${slot.confidence} confidence.${wait} This is not a live queue or predicted wait.`;
}

function sourceDateIsOldOrUnknown(
  checkedOn: string | undefined,
  now: Date,
): boolean {
  if (!checkedOn || !/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) return true;
  const parsed = new Date(`${checkedOn}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== checkedOn
  )
    return true;
  const nowTime = now.getTime();
  const sourceTime = parsed.getTime();
  return (
    !Number.isFinite(nowTime) ||
    sourceTime > nowTime ||
    nowTime - sourceTime > SOURCE_MAX_AGE_DAYS * DAY_MS
  );
}

function candidateWarnings(
  candidate: AccessCandidate,
  needs: NavigationNeeds,
  now: Date,
): string[] {
  const warnings: string[] = [];
  if (needs.householdSize !== undefined)
    warnings.push("Quantity for the declared household size is not verified.");
  if (needs.hasIdentification === "no")
    warnings.push(
      "Confirm document policy with this provider; a requested or conflicting ID note is not a confirmed requirement.",
    );

  const refs = [
    ...(candidate.resource.sources ?? []),
    ...(candidate.pantry.sources ?? []),
  ];
  if (refs.some((source) => sourceDateIsOldOrUnknown(source.checkedOn, now)))
    warnings.push(
      "One or more source records have missing, invalid, or older-than-90-day check dates; confirm current details.",
    );
  return [...new Set(warnings)];
}

/** Adds only review limitations to existing candidates; it never invents a resource or edits source facts. */
export function inspectNavigationResources(
  candidates: AccessCandidate[],
  needs: NavigationNeeds,
  now: Date,
): { candidates: NavigationResourceCandidate[]; limitations: string[] } {
  const limitations: string[] = [];
  if (needs.service === "shelter") {
    return {
      candidates: [],
      limitations: [
        "No verified shelter catalog is available; food resources cannot be treated as shelter.",
      ],
    };
  }
  if (needs.service === "prepared-meals") {
    return {
      candidates: [],
      limitations: [
        "No verified prepared-meal catalog is available; pantry records do not establish prepared meals.",
      ],
    };
  }
  if (needs.service === "groceries")
    limitations.push(
      "Groceries can be considered from pantry records; household food categories and quantities are untyped or unverified.",
    );
  if (needs.preferTransitNearby)
    limitations.push(
      "Transit-nearby preference applies only to computed transit route options; proximity alone does not establish access.",
    );

  return {
    candidates: candidates.map((candidate) => {
      const warnings = candidateWarnings(candidate, needs, now);
      if (needs.service === "groceries" && candidate.kind === "household")
        warnings.push(
          "Household food type and grocery suitability are unverified.",
        );
      const navigationWarnings = [
        ...new Set([...(candidate.navigationWarnings ?? []), ...warnings]),
      ];
      return { ...candidate, navigationWarnings };
    }),
    limitations,
  };
}
