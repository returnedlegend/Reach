import fiftyCandidates from "../../data/research/fifty-tx10-candidates.json";
import newCandidates from "../../data/research/new-tx10-candidates.json";
import candidates from "../../data/research/tx10-brazos-candidates.json";
import expansionCandidates from "../../data/research/tx10-expansion-2026-10-25.json";
import regionalCandidates from "../../data/research/tx10-regional-candidates.json";
import type {
  Pantry,
  PantryWindow,
  ScheduleRule,
  SourceRef,
} from "../lib/types";
import type { PantryVerification } from "./pantry-verification";

type SourceData = { title: string; url: string; checkedOn: string };
type Candidate = {
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number } | null;
  phone?: string;
  website?: string;
  languages?: string[];
  hours: string;
  offering: string;
  eligibility: string;
  accessibility: string;
  notes: string;
  city: string;
  postalCode?: string;
  sources: SourceData[];
  coordinateSource?: { url: string; method: string; title?: string };
  verificationStatus: "confirmed-site" | "needs-confirmation";
};

// These IDs have a pickup point inside the 119th Congress TX-10 Census polygon.
// Three Hearne/Franklin candidates are outside. Washington Mobile Pantry is
// admitted separately with its resolved coordinate in fiftyCandidates.
const admittedBrazosIds = [
  "anderson-food-pantry",
  "bedias-food-pantry",
  "christian-community-services-navasota",
  "elizabeth-lutheran-caldwell",
  "in-gods-hands-caldwell",
  "grimes-mobile-pantry",
  "madison-mobile-pantry",
  "prairie-hill-food-pantry",
  "faith-mission-brenham",
  "caldwell-christians-care",
  "lee-chapel-united-methodist-bryan",
  "new-zion-food-pantry-bryan",
];
const regionalIds = new Set([
  "bastrop-county-emergency-food-pantry",
  "giddings-area-care-center-food-pantry",
  "amen-la-grange",
  "schulenburg-area-food-pantry",
]);

const expansionIds = new Set([
  "elgin-community-cupboard",
  "smithville-food-pantry",
  "bellville-christian-food-pantry",
  "columbus-food-pantry",
  "flatonia-area-food-pantry",
]);
const newIds = new Set(
  newCandidates
    .filter((c) => c.coverage === "inside-119th-tx10")
    .map((c) => c.id),
);
const fiftyIds = new Set(fiftyCandidates.map((c) => c.id));
const providerSpecific = (id: string) =>
  fiftyIds.has(id) ||
  id === "sealy-christian-pantry" ||
  regionalIds.has(id) ||
  expansionIds.has(id);

const scheduleRules: Record<
  string,
  { weekday: number; nth: number; opens: string; closes: string }[]
> = {
  "lexington-mobile-pantry": [
    { weekday: 2, nth: 1, opens: "10:00", closes: "11:00" },
  ],
  "ridgeway-baptist-paige": [1, 2, 3].map((weekday) => ({
    weekday,
    nth: 0,
    opens: "09:00",
    closes: "12:00",
  })),
  "primera-baptist-bastrop": [1, 3].map((nth) => ({
    weekday: 6,
    nth,
    opens: "07:00",
    closes: "10:00",
  })),
  "acc-elgin-mobile-pantry": [
    { weekday: 6, nth: 1, opens: "09:00", closes: "10:30" },
  ],
  "house-of-help-hempstead": [1, 3].flatMap((nth) =>
    [3, 6].map((weekday) => ({
      weekday,
      nth,
      opens: "10:00",
      closes: "15:00",
    })),
  ),
  "pflugerville-first-united-methodist": [
    { weekday: 2, nth: 0, opens: "10:00", closes: "12:00" },
  ],
  "washington-mobile-pantry-brenham": [
    { weekday: 5, nth: 1, opens: "10:30", closes: "12:00" },
  ],
  "sealy-christian-pantry": [
    { weekday: 3, nth: 0, opens: "10:00", closes: "18:00" },
  ],
  "son-shine-outreach-madisonville": [
    { weekday: 2, nth: 0, opens: "09:00", closes: "12:00" },
    { weekday: 2, nth: 0, opens: "13:00", closes: "16:00" },
    { weekday: 3, nth: 0, opens: "09:00", closes: "12:00" },
    { weekday: 3, nth: 0, opens: "13:00", closes: "16:00" },
    { weekday: 4, nth: 0, opens: "09:00", closes: "12:00" },
    { weekday: 4, nth: 0, opens: "13:00", closes: "16:00" },
  ],
  "bread-partners-expo-brenham": [
    { weekday: 2, nth: 0, opens: "07:30", closes: "08:30" },
    { weekday: 4, nth: 0, opens: "17:30", closes: "18:30" },
  ],
  "burton-bridge-ministry-pantry": [
    { weekday: 1, nth: 0, opens: "10:00", closes: "12:00" },
    { weekday: 2, nth: 0, opens: "10:00", closes: "12:00" },
    { weekday: 3, nth: 0, opens: "15:00", closes: "17:00" },
    { weekday: 6, nth: 0, opens: "09:00", closes: "12:00" },
  ],
  "bread-partners-st-ann-somerville": [
    { weekday: 1, nth: 0, opens: "07:30", closes: "07:45" },
  ],
  "bcs-spanish-sda-produce": [
    { weekday: 2, nth: 2, opens: "13:30", closes: "16:00" },
    { weekday: 4, nth: 4, opens: "13:30", closes: "16:00" },
  ],
  "christ-church-college-station-produce": [
    { weekday: 4, nth: 1, opens: "09:30", closes: "10:30" },
    { weekday: 4, nth: 3, opens: "09:30", closes: "10:30" },
  ],
  "friends-peace-lutheran-produce": [
    { weekday: 5, nth: 0, opens: "16:00", closes: "18:00" },
  ],
  "north-bryan-new-birth-produce": [
    { weekday: 3, nth: 2, opens: "15:00", closes: "16:00" },
    { weekday: 3, nth: 4, opens: "15:00", closes: "16:00" },
  ],
  "project-downtown-produce": [
    { weekday: 6, nth: 4, opens: "10:00", closes: "10:30" },
  ],
  "sulamita-produce": [{ weekday: 6, nth: 1, opens: "09:30", closes: "10:30" }],
  "smyrna-sda-navasota-produce": [
    { weekday: 3, nth: 2, opens: "15:00", closes: "16:00" },
    { weekday: 3, nth: 4, opens: "15:00", closes: "16:00" },
  ],
  "elgin-community-cupboard": [
    { weekday: 2, nth: 0, opens: "10:00", closes: "12:00" },
  ],
  "smithville-food-pantry": [
    { weekday: 3, nth: 0, opens: "09:00", closes: "11:30" },
  ],
  "bellville-christian-food-pantry": [
    { weekday: 4, nth: 2, opens: "08:00", closes: "10:00" },
    { weekday: 4, nth: 2, opens: "17:30", closes: "18:30" },
    { weekday: 4, nth: 4, opens: "17:00", closes: "18:30" },
  ],
  "columbus-food-pantry": [
    { weekday: 5, nth: 3, opens: "08:00", closes: "12:00" },
  ],
  "flatonia-area-food-pantry": [
    { weekday: 4, nth: 2, opens: "15:30", closes: "17:30" },
  ],
  "anderson-food-pantry": [
    { weekday: 4, nth: 1, opens: "09:00", closes: "12:00" },
  ],
  "bedias-food-pantry": [
    { weekday: 6, nth: 3, opens: "09:00", closes: "12:00" },
  ],
  "christian-community-services-navasota": [
    { weekday: 1, nth: 0, opens: "09:00", closes: "11:00" },
    { weekday: 2, nth: 0, opens: "09:00", closes: "11:00" },
    { weekday: 4, nth: 0, opens: "09:00", closes: "11:00" },
    { weekday: 6, nth: 2, opens: "09:00", closes: "11:00" },
  ],
  "elizabeth-lutheran-caldwell": [
    { weekday: 6, nth: 3, opens: "07:30", closes: "10:00" },
  ],
  "in-gods-hands-caldwell": [
    { weekday: 6, nth: 2, opens: "10:00", closes: "12:30" },
    { weekday: 6, nth: 4, opens: "10:00", closes: "12:30" },
  ],
  "grimes-mobile-pantry": [
    { weekday: 4, nth: 2, opens: "10:00", closes: "11:30" },
  ],
  "prairie-hill-food-pantry": [
    { weekday: 2, nth: 2, opens: "06:30", closes: "08:00" },
    { weekday: 2, nth: 4, opens: "06:30", closes: "08:00" },
  ],
  "faith-mission-brenham": [
    { weekday: 4, nth: 0, opens: "09:30", closes: "12:30" },
  ],
  "caldwell-christians-care": [
    { weekday: 2, nth: 0, opens: "09:00", closes: "11:30" },
    { weekday: 3, nth: 0, opens: "09:00", closes: "11:30" },
  ],
  "new-zion-food-pantry-bryan": [
    { weekday: 2, nth: 3, opens: "17:00", closes: "18:00" },
  ],
  "amen-la-grange": [
    { weekday: 1, nth: 0, opens: "09:00", closes: "11:45" },
    { weekday: 4, nth: 1, opens: "16:30", closes: "18:00" },
    { weekday: 4, nth: 3, opens: "16:30", closes: "18:00" },
  ],
  "schulenburg-area-food-pantry": [
    { weekday: 4, nth: 0, opens: "09:00", closes: "11:00" },
  ],
};

const publishedServiceAreas: Record<string, string> = {
  "anderson-food-pantry": "All counties",
  "bedias-food-pantry": "Grimes County",
  "christian-community-services-navasota": "Grimes County",
  "elizabeth-lutheran-caldwell": "Burleson County",
  "in-gods-hands-caldwell": "All counties",
  "grimes-mobile-pantry": "Grimes and Washington Counties",
  "madison-mobile-pantry": "Madison County",
  "prairie-hill-food-pantry": "Washington County",
  "faith-mission-brenham": "Washington County",
  "caldwell-christians-care": "Burleson County",
  "lee-chapel-united-methodist-bryan": "Brazos Valley",
  "new-zion-food-pantry-bryan": "Brazos County",
  "amen-la-grange": "Fayette County (supplemental assistance)",
  "schulenburg-area-food-pantry": "Schulenburg area",
};

const window = (
  id: string,
  rule: ScheduleRule,
  opens: string,
  closes: string,
  sourceId: string,
  appointmentRequired?: boolean,
  policyKnown = appointmentRequired === true,
): PantryWindow => ({
  id,
  rule,
  opens,
  closes,
  ...(appointmentRequired === undefined ? {} : { appointmentRequired }),
  policyKnown,
  sourceIds: [sourceId],
});

function asCandidate(c: unknown): Candidate {
  return c as Candidate;
}

const selected = [
  ...fiftyCandidates.map(asCandidate),
  ...newCandidates.filter((c) => newIds.has(c.id)).map(asCandidate),
  ...candidates
    .filter((c) => admittedBrazosIds.includes(c.id))
    .map(asCandidate),
  ...regionalCandidates.filter((c) => regionalIds.has(c.id)).map(asCandidate),
  ...expansionCandidates.filter((c) => expansionIds.has(c.id)).map(asCandidate),
];

function candidateNotes(c: Candidate): string {
  return c.id === "madison-mobile-pantry"
    ? `${c.notes} The directory's stated fourth-Thursday recurrence conflicts with its 2026 dates: October 22 is the fourth Thursday, while November 19 and December 17 are third Thursdays. No generic schedule window is modeled; confirm each date on the current flyer.`
    : c.notes;
}

function sourceRefs(c: Candidate): SourceRef[] {
  const refs: SourceRef[] = c.sources.map((s, i) => ({
    id: `${c.id}-source-${i + 1}`,
    ...s,
    checkedOn: regionalIds.has(c.id) ? "2026-10-22" : s.checkedOn,
    verificationMethod: "website" as const,
  }));
  if (
    c.coordinateSource &&
    !refs.some((source) => source.url === c.coordinateSource?.url)
  ) {
    refs.push({
      id: `${c.id}-coordinate-source`,
      title:
        c.coordinateSource.title ??
        "U.S. Census Geocoder — address-range point",
      url: c.coordinateSource.url,
      checkedOn:
        expansionIds.has(c.id) || newIds.has(c.id) || fiftyIds.has(c.id)
          ? "2026-10-25"
          : "2026-10-22",
      verificationMethod: "website",
    });
  }
  return refs;
}

export const tx10Pantries: Pantry[] = selected.map((c) => {
  const sources = sourceRefs(c);
  const foodSource = sources.find((s) =>
    s.title.toLowerCase().includes("food bank — find food"),
  );
  const baseSource = foodSource?.id ?? sources[0].id;
  let windows: PantryWindow[] = (scheduleRules[c.id] ?? []).map((w, index) =>
    window(
      `${c.id}-distribution-${index + 1}`,
      w.nth === 0
        ? { kind: "weekly", weekdays: [w.weekday] }
        : { kind: "nth-weekday", weekday: w.weekday, nth: w.nth },
      w.opens,
      w.closes,
      baseSource,
      c.id === "sealy-christian-pantry" ? true : undefined,
    ),
  );
  if (c.id === "bastrop-county-emergency-food-pantry") {
    const src = (needle: string) =>
      sources.find((s) => s.url?.includes(needle))?.id ?? baseSource;
    windows = [
      ...[1, 3, 5].flatMap((weekday) =>
        [
          ["08:30", "11:30"],
          ["13:30", "15:00"],
        ].map(([opens, closes], i) =>
          window(
            `${c.id}-food-assistance-${weekday}-${i}`,
            { kind: "weekly", weekdays: [weekday] },
            opens,
            closes,
            src("programs/food-assistance"),
            true,
          ),
        ),
      ),
      ...[2, 3, 4].map((nth) =>
        window(
          `${c.id}-community-market-${nth}`,
          { kind: "nth-weekday", weekday: 4, nth },
          "09:30",
          "11:30",
          src("programs/community-market"),
          false,
          true,
        ),
      ),
      window(
        `${c.id}-fresh-foods-third-friday`,
        { kind: "nth-weekday", weekday: 5, nth: 3 },
        "10:00",
        "11:00",
        src("programs/fresh-foods-for-families"),
      ),
    ];
  }

  return {
    id: c.id,
    name: c.name,
    address: c.address,
    coordinates: c.coordinates
      ? { lat: c.coordinates.lat, lon: c.coordinates.lng }
      : null,
    phone: c.phone,
    languages: c.languages,
    serviceArea: publishedServiceAreas[c.id],
    pickupFormat: /drive-through/i.test(c.offering)
      ? "drive-through"
      : c.offering.includes("walk-in")
        ? "walk-in"
        : "unknown",
    pedestrianPickup: c.offering.includes("walk-in") ? "allowed" : "unknown",
    visitFrequency: c.eligibility.match(
      /(?:twice-monthly|monthly|weekly) visit limit/i,
    )?.[0],
    documents: [
      {
        name: providerSpecific(c.id)
          ? c.eligibility
          : "BVFB says ID or proof of income/address may be requested but cannot be required.",
        requirement: providerSpecific(c.id) ? "unknown" : "requested",
      },
    ],
    windows,
    walkConnections: [],
    directWalks: [],
    sources,
    notes: `${candidateNotes(c)} Pickup entrances and pedestrian routes are unreviewed. Confirm current schedule and food availability before travel.`,
    accessibility: c.accessibility,
    missingInformation: [
      "Entrance and step-free access are not documented.",
      "Food availability and holiday exceptions are not guaranteed.",
      "No direct provider confirmation or pedestrian-route review was completed.",
    ],
  };
});

export const tx10PantryVerification: Record<string, PantryVerification> =
  Object.fromEntries(
    selected.map((c) => [
      c.id,
      {
        coordinates: c.coordinates,
        status: c.verificationStatus,
        detailsNeedConfirmation: true,
        offering: c.offering,
        schedule: c.hours,
        requirements: c.eligibility,
        accessibility: c.accessibility,
        pinNotes: `${candidateNotes(c)} ${
          c.coordinateSource
            ? `Coordinate evidence: ${c.coordinateSource.method} `
            : ""
        }Pickup entrance and pedestrian routes are unreviewed.`,
        sources: sourceRefs(c)
          .filter((source) => source.url && source.checkedOn)
          .map(({ title, url, checkedOn }) => ({
            title,
            url: url!,
            checkedOn: checkedOn!,
          })),
      },
    ]),
  );

export const tx10ResourceMetadata: Record<
  string,
  {
    city: string;
    postalCode?: string;
    website?: string;
    publishedScheduleVerified?: boolean;
  }
> = Object.fromEntries(
  selected.map((c) => [
    c.id,
    {
      city: c.city,
      postalCode: c.postalCode,
      website: c.website,
      publishedScheduleVerified: expansionIds.has(c.id) || newIds.has(c.id),
    },
  ]),
);
