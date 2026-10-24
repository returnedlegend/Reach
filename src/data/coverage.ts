import type {
  PlannerData,
  PlannerInput,
  PublishedTimetable,
} from "../lib/types";
import { realPantries } from "./real-pantries";
import timetable from "./btd-timetable.json";

/** Website review is distinct from direct provider confirmation or a field walking review. */
export const officialSources = [
  {
    id: "bvfb",
    name: "Brazos Valley Food Bank — Find Food",
    url: "https://www.bvfb.org/find-food",
    lastAttempted: "2026-10-15",
    verified: true,
    status:
      "Eight local pantry listings reviewed: distribution rules, pickup formats, visit frequency, and documents requested rather than required. Hours and food stock can change.",
  },
  {
    id: "bridge",
    name: "The Bridge Ministries — Get Food",
    url: "https://thebridgeministries.org/get-food/",
    lastAttempted: "2026-10-15",
    verified: true,
    status:
      "Tuesday 3–7 p.m. shopping requires an appointment; Thursday 5:30–7 p.m. is drive-through. Walk-up access at the Thursday distribution remains unconfirmed.",
  },
  {
    id: "btd",
    name: "Brazos Transit District — official GTFS feed",
    url: "https://www.btd.org/2025btdgtfs/",
    lastAttempted: "2026-10-24",
    verified: true,
    status:
      "The retained Route 00 Orange snapshot identifies version March 25, 2026 and validity through December 31, 2026. On October 24, the current download URL returned feed metadata reporting version October 28, 2025; the public Orange timetable also conflicts with the retained snapshot. No live arrivals are connected.",
  },
  {
    id: "btd-web-timetable",
    name: "BTD Bryan/College Station Orange Route table",
    url: "https://www.btd.org/bcs/",
    lastAttempted: "2026-10-24",
    verified: true,
    status:
      "The published table says Orange departs North Terminal at :00 and reaches Forest Park Apartments at :09. The retained GTFS snapshot says departures from stop 126 at :48 and stop 134 at :53. Ask BTD which schedule to use; no provider confirmation has resolved the conflict.",
  },
  {
    id: "btd-holidays",
    name: "BTD service hours & holiday closures",
    url: "https://www.btd.org/fixed-routes/",
    lastAttempted: "2026-10-24",
    verified: true,
    status:
      "Weekday operation and ten 2026 holiday closure dates reviewed. Published closures override the GTFS feed, whose calendar_dates file contains no exceptions.",
  },
  {
    id: "tamu",
    name: "Texas A&M Transportation Services",
    url: "https://transport.tamu.edu/busroutes/",
    lastAttempted: "2026-10-15",
    verified: false,
    status:
      "The official bus-routes endpoint returned HTTP 503 on retry. No feed, eligibility rules, or complete route has been validated; this agency is not supported.",
  },
] as const;
export const coverage = {
  status: "partial",
  message:
    "Eight website-reviewed pantry listings; BTD Route 00 Orange timetable only. Source conflicts and missing pedestrian links prevent travel-ready pantry itineraries.",
  sources: officialSources,
} as const;
export const productionData: PlannerData = {
  origins: [
    {
      id: "btd-north-terminal",
      name: "BTD North Terminal · Roy Kelly Garage",
      walkConnections: [
        { stopId: "126", minutes: 0, miles: 0, reviewed: true },
      ],
    },
    {
      id: "btd-forest-park",
      name: "BTD stop · Sandy Point / Forest Park",
      walkConnections: [
        { stopId: "134", minutes: 0, miles: 0, reviewed: true },
      ],
    },
    {
      id: "btd-old-hearne",
      name: "BTD stop · Old Hearne / McHaney",
      walkConnections: [
        { stopId: "151", minutes: 0, miles: 0, reviewed: true },
      ],
    },
  ],
  pantries: realPantries,
  transit: {
    ...timetable,
    timezone: "America/Chicago",
    minTransferMinutes: 5,
    uncertainties: [
      "GTFS times differ from the official November 2025 PDF and current BTD route table. The public Bryan/College Station Orange table says North Terminal :00 and Forest Park :09; the retained GTFS snapshot says stop 126 :48 and stop 134 :53. The current GTFS download URL now returns a feed whose metadata says Updated Oct 28, 2025, while the retained snapshot says March 25, 2026. Both feeds state an end date of December 31, 2026. Confirm the applicable timetable and feed validity with BTD at 979-778-0607; these are static published times, not live service information.",
    ],
  } as PublishedTimetable,
};
export const productionDefaults: PlannerInput = {
  originId: "btd-north-terminal",
  date: "2026-10-22",
  earliestDeparture: "08:00",
  latestReturn: "14:00",
  mode: "bus",
  maxWalkMiles: 1,
  visitMinutes: 30,
  appointmentStatus: "unknown",
  arrivalBufferMinutes: 5,
};
