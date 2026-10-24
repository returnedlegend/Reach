import { pantryVerification } from "./pantry-verification";
import { tx10Pantries } from "./tx10-pantries";
import type {
  Pantry,
  PantryWindow,
  ScheduleRule,
  SourceRef,
} from "../lib/types";

/** Website-reviewed on 2026-10-15. No telephone/provider confirmation or pedestrian-route review. */
export const pantrySources: SourceRef[] = [
  {
    id: "bvfb-find-food",
    title: "Brazos Valley Food Bank — Public Pantry Distributions",
    url: "https://www.bvfb.org/find-food",
    checkedOn: "2026-10-15",
    verificationMethod: "website",
  },
  {
    id: "bridge-get-food",
    title: "The Bridge Ministries — Get Food and FAQs",
    url: "https://thebridgeministries.org/get-food/",
    checkedOn: "2026-10-15",
    verificationMethod: "website",
  },
];
const weekly = (...weekdays: number[]): ScheduleRule => ({
  kind: "weekly",
  weekdays,
});
const monthly = (weekday: number, nth: number): ScheduleRule => ({
  kind: "nth-weekday",
  weekday,
  nth,
});
const window = (
  id: string,
  rule: ScheduleRule,
  opens: string,
  closes: string,
  extra: Partial<PantryWindow> = {},
): PantryWindow => ({
  id,
  rule,
  opens,
  closes,
  policyKnown: true,
  sourceIds: ["bvfb-find-food"],
  ...extra,
});
const shared = {
  sources: [pantrySources[0]],
  coordinates: null,
  walkConnections: [],
  directWalks: [],
  visitFrequency: "Monthly",
  documents: [
    {
      name: "Identification (BVFB says it may be requested but is never required)",
      requirement: "requested" as const,
    },
    {
      name: "Proof of income or address (BVFB says it may be requested but is never required)",
      requirement: "requested" as const,
    },
  ],
  missingInformation: [
    "Holiday exceptions have not been confirmed.",
    "Coordinates and pedestrian routes have not been reviewed.",
    "Confirm that you meet the published service-area and visit-frequency rules.",
    "Separate registration cutoffs and appointment policies must be confirmed where not published.",
  ],
  notes:
    "BVFB warns pantries close if all food has been distributed. Published hours do not guarantee food availability. Website reviewed; provider not contacted.",
};
const reviewedPantryListings: Pantry[] = [
  {
    ...shared,
    id: "a-hopeful-harvest",
    name: "A Hopeful Harvest",
    address: "3608 E. 29th St., Suite 109, Bryan, TX 77802",
    phone: "828-467-2179",
    serviceArea: "Brazos County",
    pickupFormat: "walk-in",
    pedestrianPickup: "allowed",
    windows: [
      window(
        "hopeful-first-four-saturdays",
        { kind: "first-weekdays", count: 4, weekday: 6 },
        "15:00",
        "17:00",
      ),
    ],
    notes: `${shared.notes} Client choice: neighbors choose food. First four Saturdays of each month; a fifth Saturday is not included.`,
  },
  {
    ...shared,
    id: "brazos-church-pantry",
    name: "Brazos Church Pantry",
    address: "304 West 26th Street, Bryan, TX",
    phone: "979-822-2660",
    serviceArea: "Brazos Valley",
    pickupFormat: "drive-through",
    pedestrianPickup: "unknown",
    windows: [
      window("brazos-mon-wed", weekly(1, 3), "13:00", "14:30", {
        policyKnown: false,
      }),
      window("brazos-tue-thu-fri", weekly(2, 4, 5), "09:30", "11:00", {
        policyKnown: false,
      }),
      window("brazos-sat", weekly(6), "10:00", "11:30", { policyKnown: false }),
    ],
    missingInformation: [
      ...shared.missingInformation,
      "Drive-through is published; walk-up food pickup is not confirmed.",
    ],
  },
  {
    ...shared,
    id: "bridge-ministries",
    name: "The Bridge Ministries Bryan",
    address: "304 Post Office Street, Bryan, TX 77801",
    phone: "979-704-6037",
    serviceArea:
      "All counties (BVFB); provider welcomes people new to the area.",
    pickupFormat: "unknown",
    pedestrianPickup: "unknown",
    sources: pantrySources,
    languages: ["Spanish-speaking volunteers on most distribution days"],
    accessibility:
      "Provider states the entrance is ground-level and help is available for mobility needs and loading groceries.",
    bookingUrl:
      "https://www.signupgenius.com/go/10C0D4EA5A82CA7F5C16-61089050-tuesdays#/",
    documents: [
      {
        name: "Photo ID requested by provider; BVFB states ID is never required to receive food.",
        requirement: "requested",
      },
    ],
    windows: [
      window("bridge-tuesday-shopping", weekly(2), "15:00", "19:00", {
        appointmentRequired: true,
        sourceIds: ["bvfb-find-food", "bridge-get-food"],
      }),
      window("bridge-thursday-drive-through", weekly(4), "17:30", "19:00", {
        appointmentRequired: false,
        policyKnown: false,
        sourceIds: ["bvfb-find-food", "bridge-get-food"],
      }),
    ],
    notes: `${shared.notes} Tuesday is grocery-style shopping by appointment only. Thursday is drive-through without an appointment. Household limit: once a month. Provider asks for photo ID; BVFB explicitly says refusing ID cannot prevent food assistance. Office hours are not distribution hours.`,
    missingInformation: [
      ...shared.missingInformation,
      "Thursday pedestrian pickup is not confirmed; do not assume drive-through accepts walk-up visitors.",
      "Confirm ID policy if concerned: provider requests ID while BVFB says it cannot be required.",
    ],
  },
  {
    ...shared,
    id: "first-baptist-college-station",
    name: "First Baptist Church of College Station",
    address: "2300 Welsh Ave., College Station, TX",
    phone: "979-696-7000",
    serviceArea: "All counties",
    pickupFormat: "drive-through",
    pedestrianPickup: "unknown",
    languages: ["Spanish translators available"],
    visitFrequency: "Dry goods monthly; produce weekly",
    windows: [
      window("first-baptist-tuesday-dry-goods", weekly(2), "08:00", "12:00", {
        registrationOpens: "08:00",
        registrationCutoff: "10:00",
        policyKnown: false,
      }),
      window("first-baptist-tuesday-produce", weekly(2), "10:00", "12:00", {
        registrationOpens: "08:00",
        registrationCutoff: "10:00",
        policyKnown: false,
      }),
    ],
    notes: `${shared.notes} BVFB lists overall Tuesday hours 7am–noon, registration 8–10am, dry goods distribution beginning 8am, and produce beginning 10am. Volunteers help take dry goods to cars; produce is drive-through. Noon is the listed overall end, not a separately confirmed program cutoff.`,
    missingInformation: [
      ...shared.missingInformation,
      "Walk-up pickup is unconfirmed.",
      "Confirm whether the registration cutoff applies identically to dry goods and produce and each program’s final distribution cutoff.",
    ],
  },
  {
    ...shared,
    id: "first-united-methodist",
    name: "First United Methodist Church",
    address: "1125 Wellborn Rd., College Station, TX",
    phone: "713-562-1224",
    serviceArea: "Brazos County",
    pickupFormat: "drive-through",
    pedestrianPickup: "unknown",
    windows: [
      window("first-united-first-saturday", monthly(6, 1), "11:30", "13:30", {
        policyKnown: false,
      }),
    ],
    missingInformation: [
      ...shared.missingInformation,
      "Drive-through is published; pedestrian pickup is unconfirmed.",
    ],
  },
  {
    ...shared,
    id: "lincoln-house-of-hope",
    name: "Lincoln House of Hope",
    address: "1013 Eleanor Dr., College Station, TX",
    phone: "979-693-0400",
    serviceArea: "Brazos County",
    pickupFormat: "drive-through",
    pedestrianPickup: "unknown",
    languages: ["Spanish translators available"],
    windows: [
      window("lincoln-second-friday", monthly(5, 2), "08:00", "10:00", {
        policyKnown: false,
      }),
    ],
    missingInformation: [
      ...shared.missingInformation,
      "Drive-through is published; pedestrian pickup is unconfirmed.",
    ],
  },
  {
    ...shared,
    id: "parkway-baptist",
    name: "Parkway Baptist",
    address: "1501 Southwest Parkway, College Station, TX 77840",
    phone: "979-693-4701",
    serviceArea: "Brazos County",
    pickupFormat: "walk-in",
    pedestrianPickup: "allowed",
    languages: ["Spanish translators available"],
    windows: [
      window("parkway-third-saturday", monthly(6, 3), "10:00", "12:00"),
    ],
    notes: `${shared.notes} Client choice. BVFB says to call for an appointment in case of emergency; this does not establish additional open hours or a confirmed appointment.`,
  },
  {
    ...shared,
    id: "salvation-army-bryan",
    name: "The Salvation Army",
    address: "2506 Cavitt St., Bryan, TX",
    phone: "979-361-0618",
    serviceArea: "Brazos Valley",
    pickupFormat: "walk-in",
    pedestrianPickup: "allowed",
    visitFrequency: "Weekly",
    languages: ["Spanish translators available"],
    windows: [window("salvation-wed-thu", weekly(3, 4), "09:00", "11:00")],
    notes: `${shared.notes} Client choice: neighbors choose food.`,
  },
  ...tx10Pantries,
];

/** Pin audit augments the existing distribution listings, without inventing walk links. */
export const realPantries: Pantry[] = reviewedPantryListings.map((p) => {
  const review = pantryVerification[p.id];
  if (!review) return p;
  return {
    ...p,
    address: review.correctedAddress ?? p.address,
    visitFrequency:
      p.id === "a-hopeful-harvest"
        ? "Once monthly or as needed (provider)"
        : p.visitFrequency,
    windows:
      p.id === "first-united-methodist"
        ? p.windows.map((w) => ({ ...w, conflictingSources: true }))
        : p.id === "a-hopeful-harvest"
          ? p.windows.map((w) => ({ ...w, registrationOpens: "14:30" }))
          : p.windows,
    coordinates: review.coordinates
      ? { lat: review.coordinates.lat, lon: review.coordinates.lng }
      : null,
    sources: [
      ...p.sources,
      ...review.sources.map((s, i) => ({
        ...s,
        id: `${p.id}-pin-review-${i}`,
        verificationMethod: "website" as const,
      })),
    ],
    notes: `${p.notes ?? ""} ${review.pinNotes}`,
    missingInformation: p.missingInformation?.map((s) =>
      s === "Coordinates and pedestrian routes have not been reviewed." &&
      review.coordinates
        ? "Pedestrian routes and entrances have not been reviewed."
        : s,
    ),
  };
});
