import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Resource } from "../data/resources";

const instant = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);

// Keep this in step with the strict public hotspot payload contract in community.ts.
const hotspotSchema = z
  .object({
    title: text(100),
    description: text(500),
    startsAt: instant,
    endsAt: instant,
    organizerName: text(100),
    address: text(200),
    lat: z.number().min(30.4).max(30.9),
    lng: z.number().min(-96.7).max(-96.1),
    foodCategory: text(100),
    quantityText: text(100).optional(),
    eligibility: text(300),
    accessibility: text(300),
    contact: text(200),
    pickupInstructions: text(500),
  })
  .strict();

type HotspotResource = Resource & {
  communityHotspot: { recordId: string; startsAt: string; endsAt: string };
  offering: string;
  verificationStatus: "needs-confirmation";
  detailsNeedConfirmation: true;
  pedestrianPickup: "unknown";
  accessibility: string;
};

type HotspotRow = {
  id: string;
  data: string;
  starts_at: string;
  ends_at: string;
};

function parseRow(row: HotspotRow, now: Date): HotspotResource | null {
  try {
    const data = hotspotSchema.parse(JSON.parse(row.data));
    const parsedRowStartsAt = instant.parse(row.starts_at);
    const parsedRowEndsAt = instant.parse(row.ends_at);
    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    const rowStartsAt = new Date(parsedRowStartsAt);
    const rowEndsAt = new Date(parsedRowEndsAt);

    if (
      !row.id ||
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      !Number.isFinite(rowStartsAt.getTime()) ||
      !Number.isFinite(rowEndsAt.getTime()) ||
      startsAt.getTime() >= endsAt.getTime() ||
      endsAt.getTime() <= now.getTime() ||
      endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000 ||
      startsAt.getTime() !== rowStartsAt.getTime() ||
      endsAt.getTime() !== rowEndsAt.getTime()
    )
      return null;

    const canonicalStartsAt = startsAt.toISOString();
    const canonicalEndsAt = endsAt.toISOString();
    const eventTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    const unverified =
      "Community-reported; details and organizer-submitted map coordinates have not been independently verified.";
    const notes = [
      unverified,
      "This is a one-time event; its dates do not indicate a weekly schedule.",
      data.description,
      `Food: ${data.foodCategory}${data.quantityText ? `; quantity: ${data.quantityText}` : ""}.`,
      `Pickup instructions: ${data.pickupInstructions}`,
    ].join(" ");

    return {
      id: `community-hotspot:${row.id}`,
      name: data.title,
      address: data.address,
      coordinates: { lat: data.lat, lng: data.lng },
      hours: `One-time event: ${eventTime.format(startsAt)} to ${eventTime.format(endsAt)} (Central time).`,
      eligibility: `Organizer reports: ${data.eligibility}`,
      offering: `Organizer-reported food: ${data.foodCategory}${data.quantityText ? `; quantity: ${data.quantityText}` : ""}.`,
      verificationStatus: "needs-confirmation",
      detailsNeedConfirmation: true,
      pedestrianPickup: "unknown",
      accessibility: `Accessibility not independently verified. Organizer reports: ${data.accessibility}`,
      notes,
      sources: [
        {
          title: "Community-reported hotspot; not independently verified",
          url: "/food-hotspots",
        },
      ],
      communityHotspot: {
        recordId: row.id,
        startsAt: canonicalStartsAt,
        endsAt: canonicalEndsAt,
      },
    };
  } catch {
    // One malformed record must not hide valid public records in the same result.
    return null;
  }
}

/** Return approved, still-active or upcoming public hotspots for resource search. */
export function listHotspotResources(
  db: DatabaseSync,
  now: Date = new Date(),
): Resource[] {
  if (!Number.isFinite(now.getTime())) return [];
  const rows = db
    .prepare(
      `SELECT id, data, starts_at, ends_at
       FROM records
       WHERE kind = 'hotspot' AND status = 'approved' AND ends_at > ?
       ORDER BY starts_at, id`,
    )
    .all(now.toISOString()) as HotspotRow[];

  return rows.flatMap((row) => {
    const resource = parseRow(row, now);
    return resource ? [resource] : [];
  });
}
