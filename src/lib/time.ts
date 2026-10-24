/** Service times are wall-clock minutes in America/Chicago, not browser time. */
export function parseTime(value: string, allowBeyondMidnight = false): number {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value);
  if (!match || Number(match[1]) > (allowBeyondMidnight ? 47 : 23))
    throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
export function formatTime(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const local = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(local / 60);
  return `${hour % 12 || 12}:${String(Math.floor(local % 60)).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}${day > 0 ? ` (+${day} day)` : ""}`;
}
export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
/** Detect the actual zone's clock-change date without using the host timezone. */
export function hasChicagoClockChange(date: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  });
  const hour = (utcHour: string) =>
    Number(
      formatter
        .formatToParts(new Date(`${date}T${utcHour}:00:00Z`))
        .find((p) => p.type === "hour")?.value,
    );
  return hour("18") - hour("06") !== 12;
}
