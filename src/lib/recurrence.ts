import type { ScheduleRule } from "./types";
import { isDate, weekday } from "./time";

export function matchesRule(rule: ScheduleRule, date: string): boolean {
  if (!isDate(date)) return false;
  const day = Number(date.slice(8));
  if (rule.kind === "dates") return rule.dates.includes(date);
  if (rule.kind === "weekly") return rule.weekdays.includes(weekday(date));
  if (rule.kind === "nth-weekday")
    return weekday(date) === rule.weekday && Math.ceil(day / 7) === rule.nth;
  return weekday(date) === rule.weekday && Math.ceil(day / 7) <= rule.count;
}
