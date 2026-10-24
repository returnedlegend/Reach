import type { Resource } from "../data/resources";
import type { PantryWindow, SourceRef } from "./types";

/** Public pantry details. Inventory and permissions are returned separately. */
export type PantryRecord = Resource & {
  active: boolean;
  version: number;
  website: string | null;
  lastVerified: string | null;
  windows: PantryWindow[];
  /** Computed current source references for authoring structured schedules. */
  scheduleSources: SourceRef[];
  closures: string[];
  updatedAt: string;
};
export type PantryInventoryItem = {
  category: string;
  status: "available" | "limited" | "unavailable" | "unknown";
  quantity: number | null;
  source: string;
  updatedAt: string;
};
export type PantryPermissions = { canEdit: boolean; isAdmin: boolean };
export type PantryDetailResponse = {
  pantry: PantryRecord;
  inventory: PantryInventoryItem[];
  permissions: PantryPermissions;
};
/** PATCH fields. version is required; all other supplied fields replace their value. */
export type PantryPatch = Partial<
  Pick<
    PantryRecord,
    | "name"
    | "address"
    | "coordinates"
    | "phone"
    | "website"
    | "hours"
    | "eligibility"
    | "notes"
    | "offering"
    | "accessibility"
    | "verificationStatus"
    | "detailsNeedConfirmation"
    | "sources"
    | "lastVerified"
  >
> & { version: number };
export type PantryCorrection = {
  id: string;
  pantryId: string;
  pantryName: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  notes: string | null;
};
