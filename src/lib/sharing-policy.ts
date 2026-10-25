// Shared by submission, moderation and public search validation.
export const MAX_PICKUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** An ongoing pickup is valid while its end is still in the future. */
export function pickupWindowError(
  start: number,
  end: number,
  now: number,
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return "Enter a valid pickup start and end date.";
  if (end <= start) return "Pickup must end after it starts.";
  if (end <= now)
    return "This pickup has already ended. Choose a later end time.";
  if (end - start > MAX_PICKUP_WINDOW_MS)
    return "Pickup can last at most 7 days. Shorten the time between the start and end.";
  if (start > now + 30 * 86400000)
    return "Pickup must start within the next 30 days.";
  return null;
}
