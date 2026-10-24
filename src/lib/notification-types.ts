/** Browser-safe optional email preferences; all subscriptions start disabled. */
export type NotificationPreferences = {
  pantry: boolean;
  volunteer: boolean;
  pickup: boolean;
  volunteerParticipation: boolean;
};
export type NotificationCategory =
  | "security"
  | "pantry"
  | "volunteer"
  | "pickup";
export const notificationKinds = [
  "password-changed",
  "email-verified",
  "email-attached",
  "pantry-updated",
  "donation-offered",
  "new-opportunity",
  "volunteer-interest",
  "assignment-confirmed",
  "pickup-completed",
  "pickup-cancelled",
  "donation-changed",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export type NotificationEvent = {
  eventKey: string;
  userId: string;
  category: NotificationCategory;
  kind: NotificationKind;
  resourceId?: string;
  resourceType?: "pantry" | "run" | "offer" | "request";
};
