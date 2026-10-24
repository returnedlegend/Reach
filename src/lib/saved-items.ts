/** Device-only saves. Resource bookmarks contain IDs, never a starting location. */
export const SAVED_ITEMS_KEY = "reach.saved-items.v1";
export type SavedTrip = {
  id: string;
  resourceId: string;
  need: "food" | "shelter" | "transportation";
  mode: "walking" | "transit" | "driving";
  savedAt: string;
  origin?: { coordinates: { lat: number; lng: number }; label: string };
  route?: {
    label: string;
    steps: string[];
    distanceMiles?: number;
    durationMinutes?: number;
  };
};
export type SavedItems = {
  version: 1;
  resourceIds: string[];
  trips: SavedTrip[];
};
const empty = (): SavedItems => ({ version: 1, resourceIds: [], trips: [] });
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const short = (v: unknown, max = 250): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const validId = (v: unknown): v is string =>
  short(v, 100) && /^[a-zA-Z0-9_-]+$/.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

export function parseSavedItems(raw: string | null): SavedItems {
  if (!raw || raw.length > 200_000) return empty();
  try {
    const value: unknown = JSON.parse(raw, (key, item) => {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Invalid saved data");
      return item;
    });
    if (
      !record(value) ||
      value.version !== 1 ||
      !Array.isArray(value.resourceIds) ||
      !Array.isArray(value.trips) ||
      value.resourceIds.length > 200 ||
      value.trips.length > 30
    )
      return empty();
    const resourceIds = [...new Set(value.resourceIds.filter(validId))];
    const trips: SavedTrip[] = [];
    for (const item of value.trips) {
      if (
        !record(item) ||
        !validId(item.id) ||
        !validId(item.resourceId) ||
        !["food", "shelter", "transportation"].includes(String(item.need)) ||
        !["walking", "transit", "driving"].includes(String(item.mode)) ||
        !short(item.savedAt, 40) ||
        !Number.isFinite(Date.parse(item.savedAt))
      )
        continue;
      const trip: SavedTrip = {
        id: item.id,
        resourceId: item.resourceId,
        need: item.need as SavedTrip["need"],
        mode: item.mode as SavedTrip["mode"],
        savedAt: item.savedAt,
      };
      if (
        record(item.origin) &&
        record(item.origin.coordinates) &&
        short(item.origin.label)
      ) {
        const { lat, lng } = item.origin.coordinates;
        if (
          typeof lat === "number" &&
          Number.isFinite(lat) &&
          Math.abs(lat) <= 90 &&
          typeof lng === "number" &&
          Number.isFinite(lng) &&
          Math.abs(lng) <= 180
        )
          trip.origin = { coordinates: { lat, lng }, label: item.origin.label };
      }
      if (
        record(item.route) &&
        short(item.route.label, 300) &&
        Array.isArray(item.route.steps) &&
        item.route.steps.length <= 100 &&
        item.route.steps.every((s) => short(s, 1500))
      ) {
        trip.route = {
          label: item.route.label,
          steps: [...item.route.steps] as string[],
          ...(finite(item.route.distanceMiles)
            ? { distanceMiles: item.route.distanceMiles }
            : {}),
          ...(finite(item.route.durationMinutes)
            ? { durationMinutes: item.route.durationMinutes }
            : {}),
        };
      }
      trips.push(trip);
    }
    return { version: 1, resourceIds, trips };
  } catch {
    return empty();
  }
}
export function loadSavedItems(): SavedItems {
  try {
    return parseSavedItems(window.localStorage.getItem(SAVED_ITEMS_KEY));
  } catch {
    return empty();
  }
}
export function storeSavedItems(items: SavedItems): boolean {
  try {
    const raw = JSON.stringify(items);
    if (raw.length > 200_000) return false;
    const bounded = parseSavedItems(raw);
    window.localStorage.setItem(SAVED_ITEMS_KEY, JSON.stringify(bounded));
    return true;
  } catch {
    return false;
  }
}
export function savedTripText(
  trip: SavedTrip,
  destination: { name: string; address: string; hours: string },
): string {
  return [
    "Reach — saved trip",
    destination.name,
    destination.address,
    `Saved: ${new Date(trip.savedAt).toLocaleString()}`,
    `Travel: ${trip.mode}`,
    trip.origin
      ? `Starting point: ${trip.origin.label}\nExact starting point: ${trip.origin.coordinates.lat}, ${trip.origin.coordinates.lng}`
      : "Starting point was not saved. Choose one before requesting directions.",
    `Published hours: ${destination.hours}`,
    "Confirm hours, eligibility, accessibility and availability before visiting.",
    trip.route
      ? `Saved route: ${trip.route.label}\n${trip.route.steps.join("\n")}`
      : "No calculated route was saved.",
    "This is a saved snapshot, not live directions. Recheck before travel.",
  ].join("\n\n");
}
