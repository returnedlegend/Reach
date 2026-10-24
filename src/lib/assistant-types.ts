import type { AccessInput, AccessResponse } from "./access-types";
export type AssistantResponse = {
  status: "ready" | "needs-location" | "needs-details";
  reply: string;
  followUp?: string;
  plan?: AccessResponse;
  inquiryPantryId?: string;
  assistance: "ai" | "computed";
  appliedPreferences?: Partial<AccessInput>;
};
