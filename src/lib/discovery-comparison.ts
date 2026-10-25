import type { Resource } from "../data/resources";
import type { FoodComparison } from "./food-comparison";
import { summarizeResource } from "./resource-summary";
import { nextPublishedWindow } from "./discovery";

/** Discovery preference points only: no route, eligibility or stock guarantee. */
export function discoveryComparison(
  resource: Resource,
  miles: number | undefined,
  now: Date,
): FoodComparison {
  const distance =
    miles !== undefined && Number.isFinite(miles) && miles >= 0 ? miles : null;
  const distancePoints = distance === null ? 0 : 60 / (1 + distance);
  // Published distribution hours can be known while appointment/intake policy is not.
  // This copy is only for discovery timing, never for the feasibility planner.
  const scheduleResource = resource.publishedScheduleVerified
    ? {
        ...resource,
        windows: resource.windows?.map((w) => ({ ...w, policyKnown: true })),
      }
    : resource;
  const active =
    summarizeResource(scheduleResource, now).availabilityLabel ===
    "Published distribution window";
  const community = resource.communityHotspot ?? resource.communityOffer;
  const next = community
    ? { startsAt: community.startsAt, endsAt: community.endsAt }
    : nextPublishedWindow(scheduleResource, now);
  const start = next ? Date.parse(next.startsAt) : NaN;
  const end = community ? Date.parse(community.endsAt) : Infinity;
  const hoursUntil = active
    ? 0
    : Number.isFinite(start) && end > 0 && end > +now
      ? Math.max(0, (start - +now) / 3600000)
      : null;
  const schedulePoints = hoursUntil === null ? 0 : 25 / (1 + hoursUntil / 24);
  const evidencePoints =
    resource.verificationStatus === "confirmed-site" ? 15 : community ? 10 : 0;
  return {
    status: "confirm",
    score:
      Math.round((distancePoints + schedulePoints + evidencePoints) * 10) / 10,
    explanation:
      "Discovery score = 60 ÷ (1 + straight-line miles) + 25 ÷ (1 + days until published pickup) + evidence points (15 for a confirmed site, 10 for an approved community listing). Unknown distance or schedule earns zero for that component. Higher is better; this is not a trip feasibility score.",
    parameters: {
      straightLineMiles:
        distance === null ? null : Math.round(distance * 10) / 10,
      distancePoints: Math.round(distancePoints * 10) / 10,
      hoursUntilPublishedPickup:
        hoursUntil === null ? null : Math.round(hoursUntil),
      schedulePoints: Math.round(schedulePoints * 10) / 10,
      evidencePoints,
      routing: "Not checked by this score",
    },
  };
}
