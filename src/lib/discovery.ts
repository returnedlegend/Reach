import type { Resource } from "../data/resources";
import { matchesRule } from "./recurrence";
import { parseTime } from "./time";

const chicagoParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function chicagoDateAndMinute(date: Date) {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    chicagoParts.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function shiftDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Convert a Chicago wall time to its corresponding instant using the zone's
 * actual offset for that date. This avoids assuming a fixed UTC offset across
 * daylight saving changes.
 */
function chicagoWallTimeToDate(day: string, minute: number): Date {
  const [year, month, date] = day.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  const desired = Date.UTC(year, month - 1, date, hour, minuteOfHour);
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const local = chicagoDateAndMinute(new Date(instant))!;
    const [localYear, localMonth, localDate] = local.day.split("-").map(Number);
    const localWall = Date.UTC(
      localYear,
      localMonth - 1,
      localDate,
      Math.floor(local.minute / 60),
      local.minute % 60,
    );
    instant += desired - localWall;
  }
  const resolved = chicagoDateAndMinute(new Date(instant));
  if (resolved?.day !== day || resolved.minute !== minute)
    throw new Error("Chicago wall time does not exist on this date.");
  return new Date(instant);
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

/** Search only recorded directory identity and address fields. */
export function filterDirectory(
  resources: Resource[],
  query: string,
): Resource[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (!terms.length) return resources;
  return resources.filter((resource) => {
    const haystack = normalize(
      [resource.name, resource.address, resource.city, resource.postalCode]
        .filter((value): value is string => typeof value === "string")
        .join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export type PublishedWindow = { startsAt: string; label: string };

const closureCaveat =
  /programmed closures?|closure dates?|except game days|game-day/i;

/**
 * Return the next recorded distribution start within 35 days. Only explicitly
 * known, non-conflicting recurrence windows qualify. Registration times and
 * appointment rules are separate facts and do not change distribution start.
 */
export function nextPublishedWindow(
  resource: Resource,
  now: Date,
): PublishedWindow | null {
  if (resource.communityHotspot ?? resource.communityOffer) {
    const start = new Date(
      (resource.communityHotspot ?? resource.communityOffer)!.startsAt,
    );
    const end = new Date(
      (resource.communityHotspot ?? resource.communityOffer)!.endsAt,
    );
    if (!Number.isFinite(start.getTime()) || start <= now || end <= now)
      return null;
    return {
      startsAt: start.toISOString(),
      label: `${start.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · organizer-reported; confirm before visiting`,
    };
  }
  const localNow = chicagoDateAndMinute(now);
  if (!localNow || !resource.windows?.length) return null;
  if (closureCaveat.test(resource.scheduleNotes ?? "")) return null;

  const closures = new Set(
    (resource.closures ?? []).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
  );
  const latestDay = shiftDay(localNow.day, 35);
  const eligible = resource.windows.filter(
    (window) => window.policyKnown && !window.conflictingSources,
  );
  if (!eligible.length) return null;

  for (let offset = 0; offset <= 35; offset += 1) {
    const day = shiftDay(localNow.day, offset);
    if (day > latestDay || closures.has(day)) continue;
    let earliest:
      | { start: Date; appointmentRequired: boolean | undefined }
      | undefined;
    for (const window of eligible) {
      if (!matchesRule(window.rule, day)) continue;
      try {
        const minute = parseTime(window.opens);
        if (offset === 0 && minute <= localNow.minute) continue;
        const start = chicagoWallTimeToDate(day, minute);
        if (start.getTime() <= now.getTime()) continue;
        if (start.getTime() > now.getTime() + 35 * 86_400_000) continue;
        if (!earliest || start.getTime() < earliest.start.getTime())
          earliest = { start, appointmentRequired: window.appointmentRequired };
      } catch {
        // Malformed recorded times cannot establish a published opening.
      }
    }
    if (earliest) {
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(earliest.start);
      return {
        startsAt: earliest.start.toISOString(),
        label: earliest.appointmentRequired
          ? `${label} · appointment required`
          : label,
      };
    }
  }
  return null;
}
