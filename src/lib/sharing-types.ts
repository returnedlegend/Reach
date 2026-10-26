/** Browser-safe contracts for moderated, account-free food submissions. */
export type SharingKind = "hotspot" | "offer";
export type PublicSharingContact = { kind: "email" | "phone"; value: string };
export type SharingSubmissionInput = {
  requestKey: string;
  kind: SharingKind;
  contactName: string;
  contactEmail: string;
  publicContact: PublicSharingContact;
  adultConfirmed: true;
  permissionConfirmed: true;
  publicContactConsent: true;
  policyAccepted: true;
  data: Record<string, unknown>;
  photo?: string;
  testId?: string;
  testIdConsent?: true;
};
export type SharingReview = {
  id: string;
  kind: SharingKind;
  status: "pending" | "approved" | "rejected" | "removed";
  contactName: string;
  contactEmail: string;
  publicContact: PublicSharingContact;
  data: Record<string, unknown>;
  photoUrl?: string;
  hasTestId?: boolean;
  submittedAt: string;
  reviewedAt: string | null;
  reason: string | null;
  recordId: string | null;
};
export type SharingAdminResponse = {
  submissions: SharingReview[];
};
