import type { AccessInput } from "./access-types";

/** Browser-safe declared preferences, never inferred proof of eligibility or stock. */
export type NavigationNeeds = {
  service: "food" | "groceries" | "prepared-meals" | "shelter";
  urgency: "soon" | "today" | "flexible";
  householdSize?: number;
  hasIdentification: "yes" | "no" | "unknown";
  preferTransitNearby: boolean;
};
export const DEFAULT_NAVIGATION_NEEDS: NavigationNeeds = {
  service: "food",
  urgency: "today",
  hasIdentification: "unknown",
  preferTransitNearby: false,
};
export type NeedsSuggestion = {
  assistance?: "ai" | "computed";
  status: "available" | "unavailable";
  patch?: Partial<AccessInput>;
  needs?: Partial<NavigationNeeds>;
  message: string;
};
export type NavigationEvidence = {
  id: string;
  text: string;
  resourceId?: string;
};
export type NavigationGuidance = {
  assistance: "ai" | "deterministic";
  status: "ready" | "unavailable" | "not-requested";
  headline: string;
  paragraphs: string[];
  selectedId: string | null;
  alternativeIds: string[];
  evidence: NavigationEvidence[];
  modules: Array<{
    name: "needs" | "resources" | "transport" | "ranking" | "guidance";
    status: "complete" | "limited";
  }>;
  limitations: string[];
  aiCalls: number;
};
