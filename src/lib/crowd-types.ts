export const CROWD_TIME_ZONE = "America/Chicago";
export const CROWD_LEVELS = [
  "notbusy",
  "little",
  "moderate",
  "verybusy",
] as const;
export type CrowdLevel = 0 | 1 | 2 | 3;
export type CrowdConfidence = "low" | "medium" | "high";
export type CrowdSlot = {
  hour: number;
  level: CrowdLevel | null;
  waitMinutes: number | null;
  status: "observed" | "insufficient";
  confidence: CrowdConfidence | null;
  sampleCount?: number;
};
export type CrowdDay = { weekday: number; label: string; hours: CrowdSlot[] };
export type RecentCrowd = {
  level: CrowdLevel;
  waitMinutes: number | null;
  updatedAt: string;
  status: "community observations";
};
export type BusySummary = {
  pantryId: string;
  timeZone: typeof CROWD_TIME_ZONE;
  days: CrowdDay[];
  hourly: CrowdSlot[];
  recent: RecentCrowd | null;
  quieterWindow: { weekday: number; hour: number } | null;
  method: string;
  explanation: string;
};
