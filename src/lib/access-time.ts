import { isDate, parseTime, shiftDate } from "./time";
import { chicagoNow } from "./journey";
/** Exact local-to-instant conversion; refuse nonexistent or ambiguous DST wall times. */
export function chicagoWallInstant(date: string, time: string): Date | null {
  if (!isDate(date)) return null;
  let minutes: number;
  try {
    minutes = parseTime(time, true);
  } catch {
    return null;
  }
  const day = shiftDate(date, Math.floor(minutes / 1440));
  minutes %= 1440;
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const guess = Date.parse(`${day}T${clock}:00Z`),
    matches: Date[] = [];
  for (const hours of [5, 6]) {
    const instant = new Date(guess + hours * 3600000);
    const local = chicagoNow(instant);
    if (local.date === day && local.time === clock) matches.push(instant);
  }
  return matches.length === 1 ? matches[0] : null;
}
