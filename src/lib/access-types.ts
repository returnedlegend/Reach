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
};
export type AccessResponse = {
  timezone: "America/Chicago";
  options: AccessOption[];
  searchedAt: string;
  routingCalls: number;
  aiCalls: number;
  message: string;
  guidance?: import("./navigation-types").NavigationGuidance;
};
