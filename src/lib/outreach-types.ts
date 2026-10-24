/** Public contracts contain no account locations or private recipient address. */
export type OutreachRecipient = {
  id: string;
  name: string;
  addressLabel: string;
  kind: "organization" | "household";
  pantryId: string | null;
  offerId: string | null;
  sourceUrl: string;
  enrolledAt: string;
};
export type OutreachFacts = {
  availability: "available" | "limited" | "unavailable" | "unknown";
  date: string | null;
  pickupStart: string | null;
  pickupEnd: string | null;
  foodType: string;
  requirements: string;
  supportingText: string;
  uncertainty: string[];
};
export type OutreachMessage = {
  id: string;
  recipient: OutreachRecipient;
  subject: string;
  body: string;
  status:
    | "draft"
    | "queued"
    | "sending"
    | "accepted"
    | "preview"
    | "uncertain"
    | "failed"
    | "delivered"
    | "bounced"
    | "replied"
    | "cancelled";
  createdAt: string;
  sentAt: string | null;
  reply: null | {
    id: string;
    text: string;
    receivedAt: string;
    identity: "unverified-sender";
    facts: OutreachFacts;
    reviewedAt: string | null;
    expiresAt: string | null;
    pickupCoordinates?: { lat: number; lng: number } | null;
  };
  followup: null | {
    expiresAt: string;
    remaining: number;
    intervalHours: number;
  };
};
export type OutreachHistory = {
  messages: OutreachMessage[];
  recipients: OutreachRecipient[];
  deliveryMode: "resend" | "smtp" | "preview" | "disabled";
  inboundConfigured: boolean;
  ownedRecipientIds?: string[];
};
