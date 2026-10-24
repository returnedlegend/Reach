import type { Resource } from "../../src/data/resources";
import type {
  AccessAvailability,
  AccessInput,
  AccessJourney,
} from "../../src/lib/access-types";
import type {
  AccessCandidate,
  JourneyLookup,
} from "../../src/lib/access-engine";
import type { Pantry, PantryWindow } from "../../src/lib/types";

/** All records and routes here are invented for deterministic evaluation. */
export const FIXED_NOW = new Date("2026-10-22T12:00:00.000Z");
export const FUTURE_DATE = "2026-10-23";
const source = [
  {
    title: "Synthetic scenario record",
    url: "https://example.invalid/synthetic",
    checkedOn: "2026-10-22",
  },
];

export function accessInput(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    origin: { lat: 30, lng: -96 },
    date: FUTURE_DATE,
    departure: "08:00",
    mode: "walking",
    maxWalkingMinutes: 60,
    maxWalkingMiles: 4,
    fareBudget: 20,
    maxTransfers: 1,
    mobility: "standard",
    appointment: "booked",
    eligibilityConfirmed: true,
    dietaryPreference: "",
    dietaryRequired: false,
    visitMinutes: 20,
    arrivalBufferMinutes: 10,
    allowWaiting: true,
    ...overrides,
  };
}

export function syntheticWindow(
  overrides: Partial<PantryWindow> = {},
): PantryWindow {
  return {
    id: "synthetic-window",
    rule: { kind: "dates", dates: [FUTURE_DATE] },
    opens: "09:00",
    closes: "12:00",
    registrationCutoff: "11:30",
    policyKnown: true,
    sourceIds: ["synthetic"],
    ...overrides,
  };
}

export function syntheticCandidate(
  id: string,
  options: {
    name?: string;
    window?: PantryWindow | null;
    pedestrianPickup?: Pantry["pedestrianPickup"];
    availability?: AccessAvailability;
    verificationStatus?: Resource["verificationStatus"];
    detailsNeedConfirmation?: boolean;
    eligibility?: string;
    coordinates?: Resource["coordinates"];
    accessibility?: string;
    conflictingSources?: boolean;
  } = {},
): AccessCandidate {
  const window =
    options.window === null ? [] : [options.window || syntheticWindow()];
  const resource: Resource = {
    id,
    name: options.name || `Synthetic ${id}`,
    address: "Invented address, Bryan, TX",
    coordinates:
      options.coordinates === undefined
        ? { lat: 30, lng: -96.01 }
        : options.coordinates,
    hours: "Synthetic schedule",
    eligibility: options.eligibility ?? "Synthetic eligibility",
    notes: "Invented test record; not a real service.",
    accessibility: options.accessibility ?? "Synthetic access details",
    verificationStatus: options.verificationStatus ?? "confirmed-site",
    detailsNeedConfirmation: options.detailsNeedConfirmation ?? false,
    sources: source,
    windows: window,
  };
  const pantry: Pantry = {
    id,
    name: resource.name,
    address: resource.address,
    windows: window,
    walkConnections: [],
    directWalks: [],
    sources: [
      { id: "synthetic", title: "Synthetic scenario record", fictional: true },
    ],
    coordinates: resource.coordinates
      ? { lat: resource.coordinates.lat, lon: resource.coordinates.lng }
      : null,
    pedestrianPickup: options.pedestrianPickup ?? "allowed",
    ...(options.conflictingSources
      ? { missingInformation: ["Synthetic schedule conflict"] }
      : {}),
  };
  if (options.conflictingSources && pantry.windows[0])
    pantry.windows[0].conflictingSources = true;
  return {
    resource,
    pantry,
    availability: options.availability ?? {
      status: "available",
      source: "Synthetic report",
      reportedAt: "2026-10-22T10:00:00.000Z",
      // Stay current through the synthetic Oct 23 and Oct 24 service times.
      expiresAt: "2026-10-25T18:00:00.000Z",
    },
  };
}

export function syntheticJourney(
  overrides: Partial<AccessJourney> = {},
): AccessJourney {
  return {
    departure: 480,
    arrival: 510,
    walkingMinutes: 10,
    walkingMiles: 0.5,
    fare: 0,
    transfers: 0,
    source: "routed",
    steps: ["Synthetic trip"],
    paths: [],
    attribution: [],
    warnings: [],
    ...overrides,
  };
}

/** Lookup keyed by destination longitude, with optional per-call outbound/return lists. */
export function journeyLookup(
  routes: Record<
    string,
    AccessJourney[] | ((earliest: number, latest: number) => AccessJourney[])
  >,
): JourneyLookup {
  return async (_from, to, earliest, latest) => {
    const route = routes[to.lng.toFixed(4)];
    return typeof route === "function" ? route(earliest, latest) : route || [];
  };
}

export const READY_ROUTE = syntheticJourney();
