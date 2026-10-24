/** Website-only pantry pin research. Pickup details are from the food bank directory;
 * coordinates are only populated when its linked Maps target exposed a usable destination.
 * This does not verify an entrance, pedestrian route, or provider policy by direct contact.
 */
export type PantryVerification = {
  coordinates: { lat: number; lng: number } | null;
  status: "confirmed-site" | "needs-confirmation";
  correctedAddress?: string;
  detailsNeedConfirmation?: boolean;
  offering: string;
  schedule: string;
  requirements: string;
  accessibility: string;
  pinNotes: string;
  sources: { title: string; url: string; checkedOn: string }[];
};

const bvfb = {
  title: "Brazos Valley Food Bank — Public Pantry Distributions",
  url: "https://www.bvfb.org/find-food",
  checkedOn: "2026-10-16",
};

export const pantryVerification: Record<string, PantryVerification> = {
  "a-hopeful-harvest": {
    coordinates: { lat: 30.6501949, lng: -96.3352863 },
    status: "confirmed-site",
    offering: "Walk-in, client choice food distribution; serves Brazos County.",
    schedule:
      "First four Saturdays monthly, 3–5pm; provider says households may visit once monthly or as needed. Provider lists programmed closures August 29 and October 31, 2026. Food availability is not guaranteed.",
    requirements:
      "Provider says registration begins at 2:30pm. BVFB says ID and proof of income or address may be requested, but are never required. No other eligibility rule was found in the reviewed sources.",
    accessibility:
      "Walk-in service is listed; entrance, step-free access, and accommodations are not documented.",
    pinNotes:
      "BVFB lists 3608 E. 29th St., Suite 109, Bryan; the provider site repeats this pickup address. The BVFB interactive map contains a named A Hopeful Harvest feature with point geometry 30.6501949,-96.3352863. Its linked Directions view is zoomed out, so the feature geometry (not the camera center alone) supports this coordinate. No entrance or walk reviewed.",
    sources: [
      bvfb,
      {
        title: "A Hopeful Harvest — official site",
        url: "https://ahopefulharvest.com/",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB Pantry Interactive Map feature",
        url: "https://www.google.com/maps/d/u/0/viewer?mid=1hrPlvqqr4B99C7_5rLHaAA845di2q-g",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "brazos-church-pantry": {
    coordinates: { lat: 30.674241, lng: -96.3757 },
    status: "confirmed-site",
    offering: "Drive-through food distribution; serves Brazos Valley.",
    schedule:
      "Monday and Wednesday 1–2:30pm; Tuesday, Thursday, and Friday 9:30–11am; Saturday 10–11:30am. Monthly visit limit. Food may run out.",
    requirements:
      "BVFB says ID and proof of income or address may be requested, but are never required. No registration cutoff is published.",
    accessibility:
      "Drive-through service is listed. Walk-up service and accessible parking or loading details are not documented.",
    pinNotes:
      "BVFB lists 304 West 26th Street, Bryan and links the address to a Maps destination returning 304 W 26th St, Bryan, TX 77803 at 30.674241,-96.3757. The published distribution location and linked destination agree; entrance and pedestrian route remain unreviewed.",
    sources: [
      bvfb,
      {
        title: "Brazos Church Pantry — Our Location",
        url: "https://www.brazoschurchpantry.org/our_location.html",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB-linked Google Maps destination",
        url: "https://goo.gl/maps/BFJRophsc9G2",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "first-baptist-college-station": {
    coordinates: { lat: 30.5874169, lng: -96.3165231 },
    status: "confirmed-site",
    correctedAddress: "2300 Welsh Ave., College Station, TX 77845",
    offering:
      "Dry goods monthly (volunteers help load cars); produce weekly (drive-through). Serves all counties.",
    schedule:
      "Tuesdays 7am–noon overall; registration 8–10am; dry goods begin 8am; produce begins 10am. Food may run out.",
    requirements:
      "Registration is required 8–10am per BVFB. BVFB says ID and proof of income or address may be requested, but are never required. Dry goods monthly; produce weekly.",
    accessibility:
      "Drive-through is listed for produce and volunteers help load dry goods into cars. Walk-up pickup, accessible parking, and other accommodations are not documented.",
    pinNotes:
      "BVFB lists 2300 Welsh Ave., College Station and describes distributions at that church. The church's own site confirms its address is 2300 Welsh Ave., College Station, TX 77845; the linked Maps target returns that same address at 30.5874169,-96.3165231. This verifies the church site used for the pantry, but not a separate pantry entrance.",
    sources: [
      bvfb,
      {
        title: "First Baptist Church College Station — official site",
        url: "https://fbccollegestation.com/",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB-linked Google Maps destination",
        url: "https://goo.gl/maps/Qa5ES3yu9ZP2",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "first-united-methodist": {
    coordinates: { lat: 30.5946302, lng: -96.3313926 },
    status: "confirmed-site",
    detailsNeedConfirmation: true,
    offering: "Monthly drive-through distribution; serves Brazos County.",
    schedule:
      "Time conflict: BVFB lists first Saturday monthly, 11:30am–1:30pm, while the named BVFB map feature says 10:30am; provider's Manna Market page says first Saturday except game days. Confirm the applicable time and any game-day closure for the date of your visit. Food may run out.",
    requirements:
      "Monthly visit limit. BVFB says ID and proof of income or address may be requested, but are never required. No appointment or registration rule is published.",
    accessibility:
      "Drive-through service is listed. Walk-up service, accessible parking, and other accommodations are not documented.",
    pinNotes:
      "BVFB lists drive-through Manna Market pickup at 1125 Wellborn Rd., College Station. First UMC's own site confirms that address and says its Manna Market grocery giveaway is a drive-through on the first Saturday except game days. The BVFB Pantry Interactive Map has a named First United Methodist feature at 30.5946302,-96.3313926 with the same address/phone; the separately linked Directions page lacked coordinates. The map feature time (10:30am) conflicts with BVFB's hours (11:30am–1:30pm); confirm time and game-day exception for the intended date. No entrance or walk reviewed.",
    sources: [
      bvfb,
      {
        title: "First United Methodist Church College Station — Manna Market",
        url: "https://1stcollegestation.org/",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB Pantry Interactive Map feature",
        url: "https://www.google.com/maps/d/u/0/viewer?mid=1hrPlvqqr4B99C7_5rLHaAA845di2q-g",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "lincoln-house-of-hope": {
    coordinates: { lat: 30.5994015, lng: -96.33023 },
    status: "confirmed-site",
    detailsNeedConfirmation: true,
    offering:
      "Drive-through distribution; Spanish translators available; serves Brazos County.",
    schedule:
      "Second Friday monthly, 8–10am. Monthly visit limit. Food may run out.",
    requirements:
      "BVFB says ID and proof of income or address may be requested, but are never required. No registration cutoff is published.",
    accessibility:
      "Drive-through service is listed. Walk-up service, accessible parking, and other accommodations are not documented.",
    pinNotes:
      "BVFB lists Lincoln House of Hope at 1013 Eleanor Dr., College Station; its Pantry Interactive Map feature is named Lincoln House of Hope and gives that same Eleanor Dr. address with point geometry 30.5994015,-96.33023. The separate Directions shortlink resolves to a generic Maps result labelled Eleanor St. (30.599305,-96.330241); preserve the suffix mismatch and confirm before relying on precise navigation. The named feature supports the site pin. No entrance or walk reviewed.",
    sources: [
      bvfb,
      {
        title: "BVFB Pantry Interactive Map feature",
        url: "https://www.google.com/maps/d/u/0/viewer?mid=1hrPlvqqr4B99C7_5rLHaAA845di2q-g",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB-linked Google Maps Directions",
        url: "https://goo.gl/maps/2s8kkvH5yh52",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "salvation-army-bryan": {
    coordinates: { lat: 30.64562, lng: -96.36042 },
    status: "confirmed-site",
    correctedAddress: "2506 Cavitt Ave., Bryan, TX 77801",
    detailsNeedConfirmation: true,
    offering:
      "Walk-in, client choice food distribution; Spanish translators available; serves Brazos Valley.",
    schedule:
      "Wednesday and Thursday, 9–11am; weekly visit limit. Food may run out.",
    requirements:
      "BVFB says ID and proof of income or address may be requested, but are never required. No other eligibility or registration rule was found in the reviewed sources.",
    accessibility:
      "Walk-in service is listed; entrance, step-free access, and accommodations are not documented.",
    pinNotes:
      "BVFB lists 2506 Cavitt St., Bryan. The provider food-pantry page identifies Bryan College Station Corps, gives pantry hours Wednesday and Thursday 9–11am, and lists 2506 Cavitt Avenue with an explicit location coordinate 30.646,-96.36; the official Salvation Army locator lists Cavitt Ave., Bryan, TX 77801 and 30.64562,-96.36042. Thus provider sources confirm the street suffix and actual corps pantry site. The older BVFB Directions target is nearby (30.645423,-96.360395), while the BVFB Interactive Map feature geometry is about 1 km away; retain both conflicts and use the official locator point for the address-confirmed site. No pantry entrance or walk reviewed.",
    sources: [
      bvfb,
      {
        title: "Salvation Army Brazos County Corps — Food Pantry",
        url: "https://salvationarmybcs.org/bryan-collegestation/food-pantry",
        checkedOn: "2026-10-16",
      },
      {
        title: "The Salvation Army — Bryan location",
        url: "https://www.salvationarmyusa.org/tx/bryan/",
        checkedOn: "2026-10-16",
      },
      {
        title: "BVFB-linked Google Maps destination",
        url: "https://goo.gl/maps/P7JzQGGDz6T2",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "bridge-ministries": {
    coordinates: { lat: 30.6472913, lng: -96.3606034 },
    status: "confirmed-site",
    offering:
      "Tuesday grocery-style shopping by appointment; Thursday drive-through. Provider states ground-level entrance and mobility/loading help.",
    schedule:
      "Tuesday 3–7pm by signup; Thursday 5:30–7pm drive-through; monthly visit limit. Food may run out.",
    requirements:
      "Provider requests photo ID; BVFB states ID can never be required to receive food. Tuesday appointment required; Thursday no appointment. BVFB lists all counties.",
    accessibility:
      "Provider states entrance is ground-level and staff can help with mobility needs and loading groceries. Thursday pedestrian pickup is unconfirmed.",
    pinNotes:
      "Provider get-food page publishes 304 Post Office Street, Bryan, TX 77801 and links a named 'The Bridge Ministries - Food Pantry' Maps feature; destination coordinates are 30.6472913,-96.3606034. BVFB has an older conflicting Maps location; provider's current pickup page is the primary pin source. No walking route reviewed.",
    sources: [
      bvfb,
      {
        title: "The Bridge Ministries — Get Food and FAQs",
        url: "https://thebridgeministries.org/get-food/",
        checkedOn: "2026-10-16",
      },
      {
        title: "Provider-linked Google Maps destination",
        url: "https://maps.app.goo.gl/MYDwNBanzJJAf1Cb9",
        checkedOn: "2026-10-16",
      },
    ],
  },
  "parkway-baptist": {
    coordinates: { lat: 30.6038539, lng: -96.3130975 },
    status: "confirmed-site",
    offering:
      "Walk-in, client choice food distribution; Spanish translators available; serves Brazos County.",
    schedule:
      "Third Saturday monthly, 10am–noon; call for an appointment in case of emergency. Monthly visit limit. Food may run out.",
    requirements:
      "BVFB says ID and proof of income or address may be requested, but are never required. Emergency call does not establish extra hours or an appointment.",
    accessibility:
      "Walk-in service is listed; entrance, step-free access, and accommodations are not documented.",
    pinNotes:
      "BVFB lists 1501 Southwest Parkway, College Station, TX 77840 and links the named Parkway Baptist Church place. Destination 30.6038539,-96.3130975 is in Maps place data (camera center longitude -96.3156724 is not the destination). No walking route reviewed.",
    sources: [
      bvfb,
      {
        title: "BVFB-linked Google Maps destination",
        url: "https://www.google.com/maps/place/Parkway+Baptist+Church/@30.6038539,-96.3156724,17z/data=!3m1!4b1!4m6!3m5!1s0x86468487f2acd685:0xb9bdceac5db98850!8m2!3d30.6038539!4d-96.3130975!16s%2Fg%2F1tfr0t_n?entry=ttu",
        checkedOn: "2026-10-16",
      },
    ],
  },
  ...tx10PantryVerification,
};
import { tx10PantryVerification } from "./tx10-pantries";

