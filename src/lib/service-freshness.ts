import type { Resource } from "../data/resources";
import { isDate, shiftDate } from "./time";

/** Review cadence, not a guarantee that facts remain correct for this long. */
export const DIRECTORY_REVIEW_DAYS = 30;
export function serviceFreshness(
  resource: Pick<Resource, "sources">,
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);
  const dates = resource.sources
    .map((s) => s.checkedOn)
    .filter((v): v is string => Boolean(v && isDate(v) && v <= today))
    .sort();
  const incomplete =
    dates.length !== resource.sources.length || dates.length === 0;
  const oldestChecked = dates[0] ?? null;
  const nextReview = oldestChecked
    ? shiftDate(oldestChecked, DIRECTORY_REVIEW_DAYS)
    : null;
  const due = nextReview !== null && today >= nextReview;
  return {
    status: incomplete
      ? ("unknown" as const)
      : due
        ? ("review-due" as const)
        : ("recent-source-check" as const),
    oldestChecked,
    nextReview,
    label: incomplete
      ? "Some source check dates are unknown. Confirm details before travel."
      : due
        ? `Source review overdue since ${nextReview}. Confirm current details before travel.`
        : `Sources checked ${oldestChecked}; review due ${nextReview}. Food and access can still change.`,
  };
}
