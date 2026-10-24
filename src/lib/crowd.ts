import {
  CROWD_TIME_ZONE,
  type BusySummary,
  type CrowdConfidence,
  type CrowdDay,
  type CrowdLevel,
  type CrowdSlot,
} from "./crowd-types";

export type CrowdObservation = {
  weekday: number;
  hour: number;
  localDate: string;
  level: number;
  waitMinutes: number | null;
  waitReports?: number;
  observedAt: string;
  updatedAt?: string;
  reports: number;
};
export type VerifiedHourRestriction = { weekday: number; hour: number }[];
const weekdayLabels = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function chicagoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CROWD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: weekdays[get("weekday")] ?? 0,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    localDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}
function confidence(reports: number, dates: number): CrowdConfidence {
  return reports >= 20 && dates >= 6
    ? "high"
    : reports >= 10 && dates >= 4
      ? "medium"
      : "low";
}
function eligible(obs: CrowdObservation[]) {
  const byDate = new Map<string, number>();
  for (const o of obs)
    byDate.set(o.localDate, (byDate.get(o.localDate) ?? 0) + o.reports);
  return [...byDate.values()].filter((count) => count >= 3).length >= 3;
}
function slot(hour: number, observations: CrowdObservation[]): CrowdSlot {
  if (!eligible(observations))
    return {
      hour,
      level: null,
      waitMinutes: null,
      status: "insufficient",
      confidence: null,
    };
  const dates = new Set(observations.map((o) => o.localDate));
  const qualifyingDates = new Set(
    [...dates].filter(
      (date) =>
        observations
          .filter((o) => o.localDate === date)
          .reduce((s, o) => s + o.reports, 0) >= 3,
    ),
  );
  const qualified = observations.filter((o) =>
    qualifyingDates.has(o.localDate),
  );
  const count = qualified.reduce((s, o) => s + o.reports, 0);
  const level = Math.round(
    qualified.reduce((s, o) => s + o.level * o.reports, 0) / count,
  ) as CrowdLevel;
  const waits = qualified.filter(
    (o) => o.waitMinutes !== null && (o.waitReports ?? o.reports) > 0,
  );
  const waitCounts = new Map<string, number>();
  for (const o of waits)
    waitCounts.set(
      o.localDate,
      (waitCounts.get(o.localDate) ?? 0) + (o.waitReports ?? o.reports),
    );
  const waitSupported =
    [...waitCounts.values()].filter((count) => count >= 3).length >= 3;
  const waitCount = waitSupported
    ? waits.reduce((s, o) => s + (o.waitReports ?? o.reports), 0)
    : 0;
  const waitMinutes = waitCount
    ? Math.round(
        waits.reduce(
          (s, o) => s + (o.waitMinutes ?? 0) * (o.waitReports ?? o.reports),
          0,
        ) / waitCount,
      )
    : null;
  return {
    hour,
    level,
    waitMinutes,
    status: "observed",
    confidence: confidence(count, qualifyingDates.size),
  };
}
export function aggregateCrowd(input: {
  pantryId: string;
  observations: CrowdObservation[];
  now?: Date;
  recent?: CrowdObservation[];
  verifiedHourRestriction?: VerifiedHourRestriction | null;
}): BusySummary {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - 90 * 86400000);
  const historical = input.observations.filter((o) => {
    const t = Date.parse(o.observedAt);
    return Number.isFinite(t) && t >= cutoff.getTime() && t <= now.getTime();
  });
  const days: CrowdDay[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    label: weekdayLabels[weekday],
    hours: Array.from({ length: 24 }, (_, hour) =>
      slot(
        hour,
        historical.filter((o) => o.weekday === weekday && o.hour === hour),
      ),
    ),
  }));
  const current = chicagoParts(now);
  const recentObservations = (input.recent ?? []).filter((o) => {
    const t = Date.parse(o.observedAt);
    return (
      Number.isFinite(t) &&
      t >= now.getTime() - 60 * 60000 &&
      t <= now.getTime()
    );
  });
  const recentCount = recentObservations.reduce((s, o) => s + o.reports, 0);
  const recentDates = new Set(recentObservations.map((o) => o.localDate));
  let recent = null;
  const recentDay = [...recentDates]
    .filter(
      (date) =>
        recentObservations
          .filter((o) => o.localDate === date)
          .reduce((s, o) => s + o.reports, 0) >= 3,
    )
    .sort()
    .at(-1);
  if (recentDay) {
    const dayObservations = recentObservations.filter(
      (o) => o.localDate === recentDay,
    );
    const dayCount = dayObservations.reduce((s, o) => s + o.reports, 0);
    const level = Math.round(
      dayObservations.reduce((s, o) => s + o.level * o.reports, 0) / dayCount,
    ) as CrowdLevel;
    const waits = dayObservations.filter(
      (o) => o.waitMinutes !== null && (o.waitReports ?? o.reports) > 0,
    );
    const wc = waits.reduce((s, o) => s + (o.waitReports ?? o.reports), 0);
    const waitMinutes =
      wc >= 3
        ? Math.round(
            waits.reduce(
              (s, o) => s + (o.waitMinutes ?? 0) * (o.waitReports ?? o.reports),
              0,
            ) / wc,
          )
        : null;
    recent = {
      level,
      waitMinutes,
      updatedAt: dayObservations
        .map((o) => o.updatedAt ?? o.observedAt)
        .sort()
        .at(-1)!,
      status: "community observations" as const,
    };
  }
  const bins = days
    .flatMap((day) =>
      day.hours.map((value) => ({ weekday: day.weekday, hour: value.hour })),
    )
    .filter((bin) => days[bin.weekday].hours[bin.hour].status === "observed");
  let quieterWindow: { weekday: number; hour: number } | null = null;
  if (input.verifiedHourRestriction?.length) {
    const allowed = new Set(
      input.verifiedHourRestriction.map((v) => `${v.weekday}:${v.hour}`),
    );
    const candidates = bins.filter((v) =>
      allowed.has(`${v.weekday}:${v.hour}`),
    );
    candidates.sort(
      (a, b) =>
        (days[a.weekday].hours[a.hour].level ?? 3) -
        (days[b.weekday].hours[b.hour].level ?? 3),
    );
    if (candidates.length >= 2) {
      const lowest =
        days[candidates[0].weekday].hours[candidates[0].hour].level;
      const lowestBins = candidates.filter(
        (v) => days[v.weekday].hours[v.hour].level === lowest,
      );
      if (lowestBins.length === 1) quieterWindow = lowestBins[0];
    }
  }
  return {
    pantryId: input.pantryId,
    timeZone: CROWD_TIME_ZONE,
    days,
    hourly: days[current.weekday].hours,
    recent,
    quieterWindow,
    method:
      "90-day weekday and local-hour aggregates; crowd level is the report-weighted mean rounded to the nearest category. Wait is averaged using only reports that include a wait, and is hidden until supported across three dates. A quieter hour requires a unique lower observed level among at least two supported future whole hours inside verified distribution hours.",
    explanation:
      "Community observations describe reported activity, not live occupancy. A historical hour appears only with at least 3 reports on each of 3 distinct local dates. Confidence is high at 20 reports across 6 dates, medium at 10 across 4 dates, and low for other eligible bins. Sparse bins are hidden as insufficient data.",
  };
}
