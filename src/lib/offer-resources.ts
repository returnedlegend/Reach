import { MAX_PICKUP_WINDOW_MS } from "./sharing-policy";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Resource } from "../data/resources";
import { COMMUNITY_PICKUP_AREAS } from "./community-types";
import { offerHasVolunteerRun } from "./volunteer-store";

const instant = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);

// Keep in step with community.ts's strict offer payload contract. Private fields
// are validated here but are never copied into the public resource.
const offerSchema = z
  .object({
    title: text(100),
    description: text(500),
    startsAt: instant,
    endsAt: instant,
    pickupAreaId: z.enum(["bryan", "college-station"]),
    quantity: z.number().int().min(1).max(20),
    allergens: text(300),
    storage: text(300),
    useBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    foodCategory: z.enum([
      "canned-groceries",
      "dry-groceries",
      "sealed-snacks",
    ]),
    labelsIntact: z.literal(true),
    noExcludedProducts: z.literal(true),
    sealed: z.literal(true),
    shelfStable: z.literal(true),
    notHomemade: z.literal(true),
    packagingUndamaged: z.literal(true),
    notRecalled: z.literal(true),
    privatePickupInstructions: text(500),
    pickupIsPublicPlace: z.literal(true),
    sharePickupInstructions: z.boolean(),
  })
  .strict();

type OfferResource = Resource & {
  communityOffer: { recordId: string; startsAt: string; endsAt: string };
  verificationStatus: "needs-confirmation";
  detailsNeedConfirmation: true;
  pedestrianPickup: "unknown";
};

type OfferRow = {
  id: string;
  data: string;
  starts_at: string;
  ends_at: string;
};

function chicagoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseRow(row: OfferRow, now: Date): OfferResource | null {
  try {
    const data = offerSchema.parse(JSON.parse(row.data));
    const rowStart = instant.parse(row.starts_at);
    const rowEnd = instant.parse(row.ends_at);
    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    if (
      !row.id ||
      startsAt.getTime() >= endsAt.getTime() ||
      endsAt.getTime() <= now.getTime() ||
      endsAt.getTime() - startsAt.getTime() > MAX_PICKUP_WINDOW_MS ||
      startsAt.getTime() !== new Date(rowStart).getTime() ||
      endsAt.getTime() !== new Date(rowEnd).getTime() ||
      !isCalendarDate(data.useBy) ||
      chicagoDate(endsAt) > data.useBy
    )
      return null;

    const area = COMMUNITY_PICKUP_AREAS.find(
      (candidate) => candidate.id === data.pickupAreaId,
    );
    if (!area) return null;
    const city = data.pickupAreaId === "bryan" ? "Bryan" : "College Station";
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
    const disclaimer =
      "Community-shared food. Safety and availability are not verified. Check allergens and packaging; arrange pickup before traveling.";

    return {
      id: `community-offer:${row.id}`,
      name: data.title,
      address: `${area.label}; pickup is arranged after acceptance. No pickup address is published.`,
      city,
      coordinates: null,
      hours: `Pickup window: ${eventTime.format(startsAt)} to ${eventTime.format(endsAt)} (America/Chicago). ${disclaimer}`,
      eligibility:
        "Contact the offer owner through the community service after requesting this offer.",
      shortOffering: `${data.foodCategory.replaceAll("-", " ")}; quantity: ${data.quantity}.`,
      offering: `${data.foodCategory.replaceAll("-", " ")}; quantity: ${data.quantity}. Allergens: ${data.allergens}. Storage: ${data.storage}. Use by: ${data.useBy}.`,
      verificationStatus: "needs-confirmation",
      detailsNeedConfirmation: true,
      pedestrianPickup: "unknown",
      notes: `${data.description} ${disclaimer}`,
      sources: [
        {
          title: "Community-shared offer; safety and availability not verified",
          url: "/food-hotspots?type=offer",
        },
      ],
      communityOffer: {
        recordId: row.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    };
  } catch {
    return null;
  }
}

/** Return approved, unreserved public offers with a valid remaining use-by date. */
export function listOfferResources(
  db: DatabaseSync,
  now: Date = new Date(),
): Resource[] {
  if (!Number.isFinite(now.getTime())) return [];
  const rows = db
    .prepare(
      `SELECT r.id, r.data, r.starts_at, r.ends_at
       FROM records r
       WHERE r.kind = 'offer' AND r.status = 'approved' AND r.ends_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM requests q WHERE q.offer_id = r.id AND q.status = 'accepted'
         )
       ORDER BY r.starts_at, r.id`,
    )
    .all(now.toISOString()) as OfferRow[];

  return rows.flatMap((row) => {
    if (offerHasVolunteerRun(db, row.id)) return [];
    const resource = parseRow(row, now);
    return resource ? [resource] : [];
  });
}
