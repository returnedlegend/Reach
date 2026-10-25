import type { Resource } from "../data/resources";
import { matchesRule } from "./recurrence";
import { parseTime } from "./time";

export type UserSummary = {
  title: string;
  address: string;
  offering: string;
  hours: string;
  statusLabel: string;
  availabilityLabel: string;
  requirements: string;
  accessibilityLabel: string;
  sourceDetails: Resource["sources"];
};
export type VerifiedFacts = Omit<UserSummary, "availabilityLabel">;

export type ResourceOrigin = { lat: number; lng: number };
export type ResourceRankMode = "walking" | "transit" | "driving";
export type RankResourcesOptions = {
  origin?: ResourceOrigin | null;
  now?: Date;
  mode?: ResourceRankMode;
  maxDistanceMiles?: number;
};
export type RankedResource = {
  resource: Resource;
  summary: UserSummary;
  /** Straight-line distance only. This is not a walking or transit route distance. */
  straightLineMiles?: number;
};

const fallback = (value: string | undefined, text: string) =>
  value?.trim() || text;

const chicagoClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function chicagoDateAndMinute(
  now: Date,
): { date: string; minute: number } | null {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = Object.fromEntries(
    chicagoClock.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function knownClosureDates(resource: Resource): Set<string> {
  return new Set(
    (resource.closures ?? []).filter((value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value),
    ),
  );
}

function isPublishedWindow(resource: Resource, now?: Date): boolean {
  if (!now) return false;
  const local = chicagoDateAndMinute(now);
  if (
    !local ||
    !resource.windows ||
    knownClosureDates(resource).has(local.date) ||
    /programmed closures?|closure dates?|except game days|game-day/i.test(
      resource.scheduleNotes ?? "",
    )
  )
    return false;
  return resource.windows.some((window) => {
    if (
      !window.policyKnown ||
      window.conflictingSources ||
      !matchesRule(window.rule, local.date)
    )
      return false;
    try {
      const opens = parseTime(window.opens);
      const closes = parseTime(window.closes, true);
      return local.minute >= opens && local.minute < closes;
    } catch {
      return false;
    }
  });
}

/**
 * Build a display summary exclusively from the resource's recorded facts.
 * Resource schedules are human-readable and do not contain enough recurrence,
 * closure, or live inventory data to establish whether a pantry is open now.
 */
export function verifiedFacts(resource: Resource): VerifiedFacts {
  const siteConfirmed = resource.verificationStatus === "confirmed-site";
  const statusLabel = resource.detailsNeedConfirmation
    ? siteConfirmed
      ? "Location verified; details need confirmation"
      : "Details need confirmation"
    : siteConfirmed
      ? "Location verified"
      : "Needs confirmation";

  return {
    title: resource.name,
    address: fallback(resource.address, "Address not verified."),
    offering: fallback(
      resource.offering,
      "Offering details need confirmation.",
    ),
    hours: fallback(resource.hours, "Distribution hours not verified."),
    statusLabel,
    requirements: fallback(resource.eligibility, "Eligibility not verified."),
    accessibilityLabel: fallback(
      resource.accessibility,
      "Accessibility details not verified.",
    ),
    sourceDetails: resource.sources.map((source) => ({ ...source })),
  };
}

export function summarizeResource(resource: Resource, now?: Date): UserSummary {
  return {
    ...verifiedFacts(resource),
    availabilityLabel: resource.communityHotspot
      ? now &&
        Date.parse(resource.communityHotspot.startsAt) <= now.getTime() &&
        Date.parse(resource.communityHotspot.endsAt) > now.getTime()
        ? "Organizer-reported pickup window · confirm availability"
        : "Scheduled community pickup · confirm availability"
      : isPublishedWindow(resource, now)
        ? "Published distribution window"
        : "Check before visiting",
  };
}

function validPoint(
  point: ResourceOrigin | null | undefined,
): point is ResourceOrigin {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lng >= -180 &&
      point.lng <= 180,
  );
}

function distanceMiles(a: ResourceOrigin, b: ResourceOrigin): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Rank confirmed sites before sites needing confirmation, then by straight-line
 * miles when coordinates are available. Known pedestrian pickup prohibitions
 * exclude walking/transit options; proximity never establishes route reachability.
 */
export function rankResources(
  resources: Resource[],
  options: RankResourcesOptions = {},
): RankedResource[] {
  const origin = validPoint(options.origin) ? options.origin : null;
  const maximum = options.maxDistanceMiles;
  const canFilterByDistance =
    origin !== null &&
    maximum !== undefined &&
    Number.isFinite(maximum) &&
    maximum >= 0;

  return resources
    .filter(
      (resource) =>
        !["walking", "transit"].includes(options.mode ?? "") ||
        resource.pedestrianPickup !== "not-allowed",
    )
    .map((resource, index) => {
      const coordinates = validPoint(resource.coordinates)
        ? resource.coordinates
        : null;
      const miles =
        origin && coordinates ? distanceMiles(origin, coordinates) : undefined;
      return {
        resource,
        summary: summarizeResource(resource, options.now),
        ...(miles === undefined ? {} : { straightLineMiles: miles }),
        index,
        confirmed: resource.verificationStatus === "confirmed-site",
      };
    })
    .filter(
      (item) =>
        !canFilterByDistance ||
        (item.straightLineMiles !== undefined &&
          item.straightLineMiles <= (maximum as number)),
    )
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      const aHasWindow =
        a.summary.availabilityLabel === "Published distribution window";
      const bHasWindow =
        b.summary.availabilityLabel === "Published distribution window";
      if (aHasWindow !== bHasWindow) return aHasWindow ? -1 : 1;
      if (
        a.straightLineMiles !== undefined &&
        b.straightLineMiles !== undefined
      ) {
        const delta = a.straightLineMiles - b.straightLineMiles;
        if (delta !== 0) return delta;
      } else if (a.straightLineMiles !== undefined) {
        return -1;
      } else if (b.straightLineMiles !== undefined) {
        return 1;
      }
      return a.index - b.index;
    })
    .map(({ resource, summary, straightLineMiles }) => ({
      resource,
      summary,
      ...(straightLineMiles === undefined ? {} : { straightLineMiles }),
    }));
}
