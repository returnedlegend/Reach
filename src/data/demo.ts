import type {
  Pantry,
  PlannerData,
  PlannerInput,
  SourceRef,
  TransitTrip,
} from "../lib/types";

const source: SourceRef = {
  id: "fictional-pantry-fixture",
  title: "Fictional pantry scenarios — not provider information",
  fictional: true,
  verificationMethod: "fictional",
};
const transitSource: SourceRef = {
  id: "fictional-transit-fixture",
  title: "Fictional timetable and walking links — not a real route",
  fictional: true,
  verificationMethod: "fictional",
};
const weekdays = { kind: "weekly" as const, weekdays: [1, 2, 3, 4, 5] };
const pantry = (
  id: string,
  name: string,
  overrides: Partial<Pantry> = {},
): Pantry => ({
  id,
  name,
  address: "Fictional demo location — do not travel here",
  windows: [
    {
      id: `${id}-window`,
      rule: weekdays,
      opens: "09:00",
      closes: "12:00",
      appointmentRequired: false,
      policyKnown: true,
      sourceIds: [source.id],
    },
  ],
  walkConnections: [
    { stopId: "sample-food-stop", minutes: 5, miles: 0.2, reviewed: true },
  ],
  directWalks: [
    { originId: "sample-home", minutes: 30, miles: 1.4, reviewed: true },
  ],
  sources: [source],
  pickupFormat: "walk-in",
  pedestrianPickup: "allowed",
  serviceArea: "Fictional demo service area",
  documents: [
    { name: "Example household information", requirement: "requested" },
  ],
  notes:
    "Fictional scenario. Walking links are reviewed only as synthetic test fixtures.",
  ...overrides,
});
const trips: TransitTrip[] = [];
for (let hour = 8; hour <= 13; hour++) {
  const h = String(hour).padStart(2, "0");
  trips.push({
    id: `sample-out-${hour}`,
    route: "DEMO A",
    serviceId: "sample-weekdays",
    sourceIds: [transitSource.id],
    stops: [
      { stopId: "sample-home-stop", arrival: `${h}:10`, departure: `${h}:10` },
      {
        stopId: "sample-campus-stop",
        arrival: `${h}:15`,
        departure: `${h}:15`,
      },
      { stopId: "sample-hub", arrival: `${h}:20`, departure: `${h}:20` },
      { stopId: "sample-food-stop", arrival: `${h}:30`, departure: `${h}:30` },
    ],
  });
  trips.push({
    id: `sample-back-${hour}`,
    route: "DEMO A",
    serviceId: "sample-weekdays",
    sourceIds: [transitSource.id],
    stops: [
      { stopId: "sample-food-stop", arrival: `${h}:40`, departure: `${h}:40` },
      { stopId: "sample-hub", arrival: `${h}:45`, departure: `${h}:45` },
      {
        stopId: "sample-campus-stop",
        arrival: `${h}:50`,
        departure: `${h}:50`,
      },
      { stopId: "sample-home-stop", arrival: `${h}:55`, departure: `${h}:55` },
    ],
  });
}
export const demoData: PlannerData = {
  origins: [
    {
      id: "sample-home",
      name: "Sample neighborhood (fictional)",
      walkConnections: [
        { stopId: "sample-home-stop", minutes: 5, miles: 0.2, reviewed: true },
      ],
    },
    {
      id: "sample-campus",
      name: "Sample campus (fictional)",
      walkConnections: [
        {
          stopId: "sample-campus-stop",
          minutes: 4,
          miles: 0.15,
          reviewed: true,
        },
      ],
    },
    {
      id: "sample-center",
      name: "Sample community center (fictional)",
      walkConnections: [
        { stopId: "sample-hub", minutes: 3, miles: 0.1, reviewed: true },
      ],
    },
  ],
  pantries: [
    pantry("sample-community", "Sample Community Pantry"),
    pantry("sample-registration", "Sample Early Registration Pantry", {
      windows: [
        {
          id: "registration-window",
          rule: weekdays,
          opens: "08:00",
          closes: "12:00",
          registrationCutoff: "08:15",
          distributionCutoff: "11:45",
          appointmentRequired: false,
          policyKnown: true,
          sourceIds: [source.id],
        },
      ],
      notes:
        "Fictional example: registration ends before distribution. Arriving during distribution is not sufficient.",
    }),
    pantry("sample-pickup", "Sample Pickup Pantry", {
      pickupFormat: "drive-through",
      pedestrianPickup: "unknown",
      windows: [
        {
          id: "pickup-window",
          rule: weekdays,
          opens: "09:00",
          closes: "12:00",
          appointmentRequired: false,
          policyKnown: false,
          sourceIds: [source.id],
        },
      ],
      missingInformation: [
        "Whether pedestrians can collect food at this fictional drive-through distribution",
      ],
      notes: "Fictional drive-through scenario. Walk-up pickup is unconfirmed.",
    }),
    pantry("sample-appointment", "Sample Appointment Pantry", {
      windows: [
        {
          id: "appointment-window",
          rule: weekdays,
          opens: "09:00",
          closes: "12:00",
          appointmentRequired: true,
          policyKnown: true,
          sourceIds: [source.id],
        },
      ],
    }),
    pantry("sample-monthly", "Sample Monthly Pantry", {
      windows: [
        {
          id: "monthly-window",
          rule: { kind: "nth-weekday", weekday: 4, nth: 4 },
          opens: "10:00",
          closes: "12:00",
          appointmentRequired: false,
          policyKnown: true,
          sourceIds: [source.id],
        },
      ],
      notes: "Fictional monthly example: fourth Thursday, not every Thursday.",
    }),
    pantry("sample-conflict", "Sample Conflicting Information Pantry", {
      windows: [
        {
          id: "conflict-window",
          rule: weekdays,
          opens: "09:00",
          closes: "12:00",
          appointmentRequired: false,
          policyKnown: true,
          conflictingSources: true,
          sourceIds: [source.id],
        },
      ],
      missingInformation: [
        "Fictional schedule sources disagree; resolve before travel",
      ],
    }),
  ],
  transit: {
    timezone: "America/Chicago",
    validFrom: "2026-10-01",
    validTo: "2026-12-31",
    minTransferMinutes: 5,
    sources: [transitSource],
    stops: [
      { id: "sample-home-stop", name: "Sample neighborhood stop" },
      { id: "sample-campus-stop", name: "Sample campus stop" },
      { id: "sample-hub", name: "Sample transfer hub" },
      { id: "sample-food-stop", name: "Sample pantry stop" },
    ],
    calendars: [
      {
        id: "sample-weekdays",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        weekdays: [1, 2, 3, 4, 5],
        exceptions: { "2026-11-26": false },
      },
    ],
    trips,
  },
};
export const demoDefaults: PlannerInput = {
  originId: "sample-home",
  date: "2026-10-22",
  earliestDeparture: "08:00",
  latestReturn: "14:00",
  mode: "bus",
  maxWalkMiles: 1,
  visitMinutes: 20,
  appointmentStatus: "unknown",
  arrivalBufferMinutes: 5,
};
