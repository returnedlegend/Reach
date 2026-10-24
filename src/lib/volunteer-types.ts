/** Browser-safe donation-run contracts. No contact details or private pickup notes. */
export type VolunteerRunStatus =
  | "pending"
  | "open"
  | "assigned"
  | "completed"
  | "cancelled";
export type VolunteerRun = {
  id: string;
  offerId: string;
  pantryId: string;
  pantryName: string;
  offerTitle: string;
  pickupAreaId: "bryan" | "college-station";
  quantity: number;
  foodCategory: string;
  allergens: string;
  storage: string;
  useBy: string;
  startsAt: string;
  endsAt: string;
  status: VolunteerRunStatus;
  createdAt: string;
  updatedAt: string;
};
export type ManagedVolunteerRun = VolunteerRun & {
  donorId: string;
  volunteerId: string | null;
  canApprove: boolean;
  canCancel: boolean;
  canComplete: boolean;
  canRelease: boolean;
  canViewPickup: boolean;
};
export type EligibleVolunteerOffer = Pick<
  VolunteerRun,
  "offerId" | "offerTitle" | "startsAt" | "endsAt" | "quantity" | "pickupAreaId"
>;
export type VolunteerDiscovery = { runs: VolunteerRun[] };
export type VolunteerDashboard = {
  runs: ManagedVolunteerRun[];
  participationEnabled: boolean;
  emailVerified: boolean;
};
export type VolunteerPickup = {
  instructions: string;
  area: { id: string; label: string; lat: number; lng: number } | undefined;
};
