/** Browser-safe community contracts. This is a development pilot, not a verified service. */
export const COMMUNITY_PICKUP_AREAS = [
  {
    id: "bryan",
    label: "Bryan — approximate area",
    lat: 30.6744,
    lng: -96.3698,
  },
  {
    id: "college-station",
    label: "College Station — approximate area",
    lat: 30.62798,
    lng: -96.3344,
  },
] as const;
export type CommunityRole = "resident" | "organizer" | "moderator";
export type CommunityUser = {
  id: string;
  username: string;
  role: CommunityRole;
};
export type CommunityStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "ended"
  | "expired";
export type HotspotDraft = {
  title: string;
  description: string;
  organizerName: string;
  address: string;
  lat: number;
  lng: number;
  startsAt: string;
  endsAt: string;
  foodCategory: string;
  quantityText?: string;
  eligibility: string;
  accessibility: string;
  contact: string;
  pickupInstructions: string;
};
export type OfferDraft = {
  title: string;
  description: string;
  pickupAreaId: "bryan" | "college-station";
  startsAt: string;
  endsAt: string;
  quantity: number;
  allergens: string;
  storage: string;
  useBy: string;
  foodCategory: "canned-groceries" | "dry-groceries" | "sealed-snacks";
  labelsIntact: true;
  noExcludedProducts: true;
  sealed: true;
  shelfStable: true;
  notHomemade: true;
  packagingUndamaged: true;
  notRecalled: true;
  privatePickupInstructions: string;
  pickupIsPublicPlace: true;
  sharePickupInstructions: boolean;
};
export type CommunityRecord = {
  id: string;
  ownerId: string;
  kind: "hotspot" | "offer";
  status: CommunityStatus;
  createdAt: string;
  updatedAt: string;
  moderationReason?: string;
  photoUrl?: string;
  publicContact?: { kind: "email" | "phone"; value: string };
} & Partial<HotspotDraft & Omit<OfferDraft, "foodCategory">> & {
    title: string;
    description: string;
    startsAt: string;
    endsAt: string;
    availability?: "scheduled" | "active";
  };
export type CommunityRequest = {
  id: string;
  offerId: string;
  requesterId: string;
  ownerId: string;
  status: "requested" | "accepted" | "declined" | "cancelled" | "collected";
  createdAt: string;
  updatedAt: string;
  offerTitle: string;
};
export type CommunityDiscovery = {
  mode: "development";
  pickupAreas: typeof COMMUNITY_PICKUP_AREAS;
  hotspots: CommunityRecord[];
  offers: CommunityRecord[];
};
export type CommunityMine = {
  hotspots: CommunityRecord[];
  offers: CommunityRecord[];
  requests: CommunityRequest[];
  organizerRequested: string | null;
};
export type CommunityModeration = {
  hotspots: CommunityRecord[];
  offers: CommunityRecord[];
  organizers: { id: string; username: string; createdAt: string }[];
  reports: {
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
    createdAt: string;
  }[];
  audit: {
    actorId: string | null;
    action: string;
    targetId: string;
    createdAt: string;
    reason?: string | null;
  }[];
};
