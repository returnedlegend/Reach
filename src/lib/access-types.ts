import type { MapCoordinates, MapPath, MapAttribution } from "./map-types";
import type { Resource } from "../data/resources";

/** Browser-safe access contracts. Times are America/Chicago service-day minutes. */
export type AccessInput = {
  origin: MapCoordinates;
  date: string;
  departure: string;
  mode: "walking" | "transit" | "driving";
  maxWalkingMinutes: number;
  maxWalkingMiles: number;
  fareBudget: number;
  maxTransfers: number;
  mobility: "standard" | "step-free";
  appointment: "booked" | "not-booked" | "unknown";
  eligibilityConfirmed: boolean;
  dietaryPreference: string;
  dietaryRequired: boolean;
  visitMinutes: number;
  arrivalBufferMinutes: number;
  allowWaiting: boolean;
  arrivalDeadline?: string;
  returnTo?: MapCoordinates;
  returnDeadline?: string;
};
export type AccessJourney = {
  mode?: AccessInput["mode"];
  /** Routed totals, never straight-line distance. Optional for legacy saved trips. */
  distanceMiles?: number;
  durationMinutes?: number;
  departure: number;
  arrival: number;
  walkingMinutes: number;
  walkingMiles: number;
  fare: number | null;
  transfers: number;
  source: "routed" | "scheduled";
  steps: string[];
  paths: MapPath[];
  attribution: MapAttribution[];
  warnings: string[];
};
export type AccessAvailability = {
  status: "available" | "limited" | "unavailable" | "unknown";
  source: string;
  reportedAt: string | null;
  expiresAt: string | null;
};
export type AccessOption = {
  id: string;
  kind: "pantry" | "household";
  resource: Resource;
  status: "fits" | "confirm" | "no";
  reasons: string[];
  warnings: string[];
  labels: string[];
  availability: AccessAvailability;
  outbound: AccessJourney | null;
  returnJourney: AccessJourney | null;
  serviceStart: number | null;
  serviceEnd: number | null;
  intakeCutoff: number | null;
  score: number;
  /** Comparison points, not probabilities or actual unknown costs. */
  scoreBreakdown?: {
    travelPenalty: number;
    walkingPenalty: number;
    farePenalty: number;
    transferPenalty: number;
    uncertaintyPenalty: number;
    waitingPenalty: number;
    serviceDelayPenalty: number;
    closingBufferBonus: number;
    totalTravelMinutes: number;
    totalWalkingMinutes: number;
    totalFare: number | null;
    totalTransfers: number;
    waitingMinutes: number;
    intakeSlackMinutes: number;
  };
};
export type PantryRecommendation = {
  algorithm: "feasibility-weighted-v1";
  status: "ready" | "confirm" | "unavailable";
  selectedId: string | null;
  alternativeIds: string[];
  paretoFrontierIds: string[];
  headline: string;
  explanation: string[];
  comparison: {
    scope: "catalog" | "selected-destination";
    totalPantries: number;
    verifiedPantries: number;
    routedPantries: number;
    staticallyExcludedPantries: number;
    unresolvedPantries: number;
    unverifiedPantries: number;
    siteLimit: number;
    routeLimitReached: boolean;
    complete: boolean;
  };
};
export type AccessResponse = {
  timezone: "America/Chicago";
  options: AccessOption[];
  searchedAt: string;
  routingCalls: number;
  aiCalls: number;
  message: string;
  recommendation?: PantryRecommendation;
  guidance?: import("./navigation-types").NavigationGuidance;
};
