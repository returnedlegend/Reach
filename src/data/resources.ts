import { realPantries } from "./real-pantries";
import type { Pantry, PantryWindow } from "../lib/types";
import type { PantryVerification } from "./pantry-verification";
import { pantryVerification } from "./pantry-verification";
import { tx10ResourceMetadata } from "./tx10-pantries";
import timetable from "./btd-timetable.json";
export type Resource = {
  /** Approved household offer. Public records never contain a pickup address. */
  communityOffer?: { recordId: string; startsAt: string; endsAt: string };
  /** Approved community distribution; not an independently verified pantry. */
  communityHotspot?: { recordId: string; startsAt: string; endsAt: string };
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number } | null;
  website?: string | null;
  city?: string;
  postalCode?: string;
  hours: string;
  eligibility: string;
  notes: string;
  phone?: string;
  offering?: string;
  shortOffering?: string;
  languages?: string[];
  pedestrianPickup?: "allowed" | "not-allowed" | "unknown";
  verificationStatus?: "confirmed-site" | "needs-confirmation";
  accessibility?: string;
  detailsNeedConfirmation?: boolean;
  sources: { title: string; url?: string; checkedOn?: string }[];
  windows?: PantryWindow[];
  closures?: string[];
  scheduleNotes?: string;
};
export function resourceFromPantry(
  p: Pantry,
  review?: PantryVerification,
): Resource {
  const metadata = tx10ResourceMetadata[p.id];
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    coordinates: review?.coordinates ?? null,
    website: metadata?.website,
    city: metadata?.city,
    postalCode: metadata?.postalCode,
    phone: p.phone,
    offering: review?.offering ?? "Food assistance; details need confirmation.",
    languages: p.languages,
    pedestrianPickup: p.pedestrianPickup ?? "unknown",
    verificationStatus: review?.status ?? "needs-confirmation",
    detailsNeedConfirmation: review
      ? Boolean(review.detailsNeedConfirmation)
      : true,
    hours: review?.schedule ?? "Distribution hours not verified.",
    eligibility: review?.requirements ?? "Eligibility not verified.",
    accessibility: review?.accessibility ?? "Accessibility not verified.",
    notes: review?.pinNotes ?? "Map coordinates not verified.",
    sources: review?.sources ?? p.sources,
    windows: p.windows,
    closures: p.closures ?? [],
    scheduleNotes: p.notes,
  };
}
export const foodResources = realPantries.map((p) =>
  resourceFromPantry(p, pantryVerification[p.id]),
);
export const transitStops = timetable.stops.map((s) => ({
  id: s.id,
  name: s.name,
  lat: s.lat,
  lng: s.lon,
}));
export const transportResources: Resource[] = transitStops.map((s) => ({
  id: s.id,
  name: s.name,
  address: "BTD Route 00 Orange stop " + s.id,
  coordinates: { lat: s.lat, lng: s.lng },
  hours: "Published weekday service; holidays and feed validity apply.",
  eligibility: "Public transit. Confirm fare and accessibility needs with BTD.",
  notes:
    "Official GTFS stop. Published timetables disagree; confirm departures. No live predictions connected.",
  phone: "979-778-0607",
  sources: timetable.sources,
}));
