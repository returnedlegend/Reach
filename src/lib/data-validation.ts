import type { PlannerData, SourceRef } from "./types";
import { isDate } from "./time";

/** Editorial preflight, not proof that a provider is open or a route is safe. */
export function validateData(data: PlannerData): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);
  const unique = (ids: string[], scope: string) => {
    if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
      fail(`${scope}: IDs must be nonempty and unique`);
  };
  const date = (value: string, label: string) => {
    if (!isDate(value)) fail(`${label}: invalid date`);
  };
  const time = (value: string, label: string) => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      fail(`${label}: invalid HH:mm time`);
  };
  const positive = (value: number, label: string, allowZero = false) => {
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
      fail(`${label}: invalid duration or distance`);
  };
  const sourceCheck = (sources: SourceRef[], scope: string) => {
    unique(
      sources.map((s) => s.id),
      `${scope} sources`,
    );
    for (const s of sources) {
      if (!s.title.trim()) fail(`${scope}/${s.id}: source title required`);
      if (s.fictional) {
        if (s.url)
          fail(`${scope}/${s.id}: fictional facts must not cite real URLs`);
        continue;
      }
      if (!s.url || !/^https:\/\//.test(s.url))
        fail(`${scope}/${s.id}: real source needs HTTPS URL`);
      if (!s.checkedOn || !isDate(s.checkedOn))
        fail(`${scope}/${s.id}: real source needs checkedOn date`);
      if (
        !["website", "provider-confirmation"].includes(
          s.verificationMethod ?? "",
        )
      )
        fail(
          `${scope}/${s.id}: real source needs verificationMethod provenance`,
        );
    }
  };
  const refs = (ids: string[], sources: SourceRef[], label: string) => {
    if (!ids.length) fail(`${label}: source reference required`);
    for (const id of ids)
      if (!sources.some((s) => s.id === id))
        fail(`${label}: missing source ${id}`);
  };
  const days = (values: number[], label: string) => {
    if (values.some((v) => !Number.isInteger(v) || v < 0 || v > 6))
      fail(`${label}: invalid weekday`);
  };
  unique(
    data.origins.map((x) => x.id),
    "origins",
  );
  unique(
    data.pantries.map((x) => x.id),
    "pantries",
  );
  const t = data.transit;
  unique(
    t.stops.map((x) => x.id),
    "stops",
  );
  unique(
    t.calendars.map((x) => x.id),
    "calendars",
  );
  unique(
    t.trips.map((x) => x.id),
    "trips",
  );
  date(t.validFrom, "transit validFrom");
  date(t.validTo, "transit validTo");
  if (t.validFrom > t.validTo) fail("transit: inverted validity dates");
  positive(t.minTransferMinutes, "transfer minutes", true);
  sourceCheck(t.sources, "transit");
  const walks = (
    connections: {
      stopId?: string;
      originId?: string;
      minutes: number;
      miles: number;
      reviewed: boolean;
    }[],
    label: string,
  ) => {
    for (const w of connections) {
      if (w.stopId && !t.stops.some((s) => s.id === w.stopId))
        fail(`${label}: missing stop ${w.stopId}`);
      if (w.originId && !data.origins.some((o) => o.id === w.originId))
        fail(`${label}: missing origin ${w.originId}`);
      positive(w.minutes, `${label} walking minutes`, true);
      positive(w.miles, `${label} walking miles`, true);
      if ((w.minutes === 0) !== (w.miles === 0))
        fail(`${label}: zero-distance stop access must have zero walking time`);
      if (w.reviewed !== true)
        fail(`${label}: walking connection requires review before publication`);
    }
  };
  for (const origin of data.origins) walks(origin.walkConnections, origin.id);
  for (const c of t.calendars) {
    date(c.startDate, `${c.id} start`);
    date(c.endDate, `${c.id} end`);
    days(c.weekdays, c.id);
    if (c.startDate > c.endDate) fail(`${c.id}: inverted calendar dates`);
    for (const [d, active] of Object.entries(c.exceptions ?? {})) {
      date(d, c.id);
      if (typeof active !== "boolean")
        fail(`${c.id}: exception must be boolean`);
    }
  }
  for (const trip of t.trips) {
    if (!t.calendars.some((c) => c.id === trip.serviceId))
      fail(`${trip.id}: missing service calendar`);
    refs(trip.sourceIds, t.sources, trip.id);
    if (trip.stops.length < 2) fail(`${trip.id}: needs at least two stops`);
    let previous = "";
    for (const s of trip.stops) {
      if (!t.stops.some((stop) => stop.id === s.stopId))
        fail(`${trip.id}: missing stop ${s.stopId}`);
      for (const value of [s.arrival, s.departure])
        if (!/^(?:[0-3]\d|4[0-7]):[0-5]\d$/.test(value))
          fail(`${trip.id}: invalid service time (00:00–47:59)`);
      if (s.arrival < previous || s.departure < s.arrival)
        fail(`${trip.id}: timetable is not chronological`);
      previous = s.departure;
    }
  }
  for (const p of data.pantries) {
    sourceCheck(p.sources, p.id);
    if (!p.sources.length) fail(`${p.id}: source provenance required`);
    unique(
      p.windows.map((w) => w.id),
      `${p.id} windows`,
    );
    walks(p.walkConnections, p.id);
    walks(p.directWalks, p.id);
    if (
      p.coordinates &&
      (!Number.isFinite(p.coordinates.lat) ||
        !Number.isFinite(p.coordinates.lon) ||
        Math.abs(p.coordinates.lat) > 90 ||
        Math.abs(p.coordinates.lon) > 180)
    )
      fail(`${p.id}: invalid coordinates`);
    for (const closure of p.closures ?? []) date(closure, p.id);
    for (const w of p.windows) {
      refs(w.sourceIds, p.sources, w.id);
      time(w.opens, w.id);
      time(w.closes, w.id);
      if (w.opens >= w.closes) fail(`${w.id}: window must close after opening`);
      for (const value of [
        w.registrationOpens,
        w.registrationCutoff,
        w.distributionCutoff,
      ])
        if (value) time(value, w.id);
      if (
        w.registrationOpens &&
        w.registrationCutoff &&
        w.registrationOpens > w.registrationCutoff
      )
        fail(`${w.id}: inverted registration window`);
      if (w.rule.kind === "weekly") days(w.rule.weekdays, w.id);
      else if (w.rule.kind === "dates")
        w.rule.dates.forEach((d) => date(d, w.id));
      else {
        days([w.rule.weekday], w.id);
        const n = w.rule.kind === "nth-weekday" ? w.rule.nth : w.rule.count;
        if (!Number.isInteger(n) || n < 1 || n > 5)
          fail(`${w.id}: invalid monthly occurrence`);
      }
    }
  }
  return errors;
}
