export type SourceRef = {
  id: string;
  title: string;
  url?: string;
  checkedOn?: string;
  fictional?: boolean;
  verificationMethod?: "website" | "provider-confirmation" | "fictional";
};
export type WalkConnection = {
  stopId: string;
  minutes: number;
  miles: number;
  reviewed: boolean;
};
export type Origin = {
  id: string;
  name: string;
  walkConnections: WalkConnection[];
};
export type ScheduleRule =
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "nth-weekday"; weekday: number; nth: number }
  | { kind: "first-weekdays"; count: number; weekday: number }
  | { kind: "dates"; dates: string[] };
export type PantryWindow = {
  id: string;
  rule: ScheduleRule;
  opens: string;
  closes: string;
  registrationOpens?: string;
  registrationCutoff?: string;
  distributionCutoff?: string;
  appointmentRequired?: boolean;
  policyKnown: boolean;
  conflictingSources?: boolean;
  sourceIds: string[];
};
export type Pantry = {
  id: string;
  name: string;
  address: string;
  windows: PantryWindow[];
  walkConnections: WalkConnection[];
  directWalks: {
    originId: string;
    minutes: number;
    miles: number;
    reviewed: boolean;
  }[];
  sources: SourceRef[];
  notes?: string;
  phone?: string;
  coordinates?: { lat: number; lon: number } | null;
  serviceArea?: string;
  pickupFormat?: "walk-in" | "drive-through" | "unknown";
  pedestrianPickup?: "allowed" | "not-allowed" | "unknown";
  visitFrequency?: string;
  documents?: {
    name: string;
    requirement: "requested" | "required" | "unknown";
  }[];
  languages?: string[];
  accessibility?: string;
  bookingUrl?: string;
  closures?: string[];
  missingInformation?: string[];
};
export type ServiceCalendar = {
  id: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
  exceptions?: Record<string, boolean>;
};
export type TransitTrip = {
  id: string;
  route: string;
  serviceId: string;
  stops: { stopId: string; arrival: string; departure: string }[];
  sourceIds: string[];
};
export type PublishedTimetable = {
  uncertainties?: string[];
  timezone: "America/Chicago";
  validFrom: string;
  validTo: string;
  calendars: ServiceCalendar[];
  trips: TransitTrip[];
  stops: { id: string; name: string }[];
  sources: SourceRef[];
  minTransferMinutes: number;
};
export type PlannerInput = {
  originId: string;
  date: string;
  earliestDeparture: string;
  latestReturn: string;
  mode: "bus" | "walk";
  maxWalkMiles: number;
  visitMinutes: number;
  appointmentStatus: "booked" | "not-booked" | "unknown";
  arrivalBufferMinutes?: number;
  boardingBufferMinutes?: number;
  skipDepartures?: number;
};
export type Segment = {
  kind: "walk" | "bus" | "wait" | "visit";
  from: string;
  to: string;
  start: number;
  end: number;
  miles?: number;
  route?: string;
  tripId?: string;
  sourceIds?: string[];
};
export type PlanResult = {
  pantryId: string;
  status: "fits" | "confirm" | "no";
  reasons: string[];
  windowId?: string;
  arrival?: number;
  returnAt?: number;
  walkingMiles?: number;
  segments: Segment[];
  sources: SourceRef[];
};
export type PlannerData = {
  origins: Origin[];
  pantries: Pantry[];
  transit: PublishedTimetable;
};
export type TransitJourney = {
  departure: number;
  arrival: number;
  segments: Segment[];
};
export interface TransitProvider {
  journeys(
    date: string,
    fromStop: string,
    toStop: string,
    earliest: number,
    latest: number,
  ): TransitJourney[];
  isValid(date: string): boolean;
}
