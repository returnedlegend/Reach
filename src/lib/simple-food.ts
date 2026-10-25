import type { Resource } from "@/data/resources";
import { filterDirectory, nextPublishedWindow } from "./discovery";
import {
  googleMapsUrl,
  validCoordinates,
  type Coordinates,
  type TravelMode,
} from "./journey";
import { rankResources } from "./resource-summary";

export type FoodIntent = {
  service?: "food" | "groceries" | "prepared-meals" | "shelter";
  mode?: TravelMode;
};
export function rejectedFoodModes(text: string): TravelMode[] {
  const request = normalize(text).replace(/’/g, "'");
  const rejected: TravelMode[] = [];
  if (
    /\b(?:cannot|can't|can not|unable to|not able to|don't|do not)\s+walk(?:ing)?\b(?!\s+(?:more|over|for|far|long|to|that|very|much|without|a|an)\b|\s+\d)/.test(
      request,
    )
  )
    rejected.push("walking");
  if (
    /\b(?:no|cannot|can't|don't|do not)\s+(?:(?:take|use|ride)\s+)?(?:a |the )?(?:bus|transit)\b/.test(
      request,
    )
  )
    rejected.push("transit");
  if (
    /\b(?:cannot|can't|don't|do not)\s+drive\b|\b(?:no car|don't have a car|do not have a car)\b/.test(
      request,
    )
  )
    rejected.push("driving");
  return rejected;
}
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const pilot = (r: Resource) =>
  !!(r.communityHotspot ?? r.communityOffer) ||
  /\b(?:bryan|college station)\b/i.test(`${r.city ?? ""} ${r.address}`);

/** Small, transparent fallback. It interprets requests, never supplies new facts. */
export function localFoodIntent(text: string): FoodIntent {
  const request = normalize(text).replace(/’/g, "'");
  const rejected =
    /\b(?:no|cannot|can't|don't|do not)\s+(?:(?:take|use|ride)\s+)?(?:a |the )?(?:bus|transit)\b/.test(
      request,
    );
  const mode =
    /\b(?:walk|walking|on foot)\b/.test(request) &&
    !/\b(?:cannot|can't|don't|do not)\s+walk/.test(request)
      ? "walking"
      : (/\b(?:bus|public transit)\b/.test(request) ||
            /\b(?:no car|don't have a car|do not have a car|without a car)\b/.test(
              request,
            )) &&
          !rejected
        ? "transit"
        : /\b(?:driving|by car|have a car)\b/.test(request) &&
            !/\b(?:no car|don't have a car|do not have a car)\b/.test(request)
          ? "driving"
          : undefined;
  const serviceText = request.replace(
    /\b(?:don't|do not|not)\s+(?:(?:need|want)\s+)?(?:a |any )?(?:shelter|hot meals?|prepared meals?)\b/g,
    " ",
  );
  const service = /\b(?:shelter|place to sleep)\b/.test(serviceText)
    ? "shelter"
    : /\b(?:hot meals?|hot food|prepared meals?|ready.to.eat|no (?:kitchen|stove)|cannot cook|can't cook)\b/.test(
          serviceText,
        )
      ? "prepared-meals"
      : "food";
  return { service, ...(mode ? { mode } : {}) };
}

export function discoverFood(
  resources: Resource[],
  request: string,
  options: {
    origin?: Coordinates;
    mode?: TravelMode;
    now?: Date;
    intent?: FoodIntent;
  } = {},
) {
  const text = normalize(request).trim();
  const intent = { ...options.intent, ...localFoodIntent(request) };
  // A specific external AI interpretation can refine generic food, but never replace
  // an explicit local restriction or populate an origin.
  if (intent.service === "food" && options.intent?.service)
    intent.service = options.intent.service;
  const mode = options.mode ?? intent.mode ?? "walking";
  const blockedMode = rejectedFoodModes(request).includes(mode);
  const cities = [
    ...new Set(
      resources
        .flatMap((r) =>
          r.city
            ? [normalize(r.city)]
            : [
                r.address.match(/,\s*([^,]+),\s*TX\b/i)?.[1]?.toLowerCase() ??
                  "",
              ],
        )
        .filter(Boolean),
    ),
  ];
  const escapedCity = (city: string) =>
    city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const deniedCities = cities.filter((city) =>
    new RegExp(
      `\\b(?:not|except|outside|anything but)\\s+(?:(?:in|near|around)\\s+)?${escapedCity(city)}\\b`,
    ).test(text),
  );
  let affirmativeText = text;
  for (const city of deniedCities)
    affirmativeText = affirmativeText.replace(
      new RegExp(
        `\\b(?:not|except|outside|anything but)\\s+(?:(?:in|near|around)\\s+)?${escapedCity(city)}\\b`,
        "g",
      ),
      " ",
    );
  const allowed = resources.filter(
    (resource) =>
      (!(resource.communityHotspot ?? resource.communityOffer) ||
        Date.parse(
          (resource.communityHotspot ?? resource.communityOffer)!.endsAt,
        ) > (options.now ?? new Date()).getTime()) &&
      !deniedCities.some((city) =>
        new RegExp(`\\b${escapedCity(city)}\\b`).test(
          normalize(`${resource.city ?? ""} ${resource.address}`),
        ),
      ),
  );
  const namedCities = cities.filter((city) =>
    new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
      affirmativeText,
    ),
  );
  const zip = text.match(/\b\d{5}\b/)?.[0];
  const general =
    /\b(?:food|hungry|grocer\w*|pantr\w*|meal\w*|eat|help|comida|alimentos)\b/.test(
      text,
    ) ||
    Boolean(intent.mode) ||
    /\b(?:walk(?:ing)?|appointments?|wheelchair|fare|budget|money|transfers?|hours|open|no id|without id)\b/.test(
      text,
    );
  const place = affirmativeText
    .match(
      /\b(?:in|near|around)\s+([a-z][a-z .'-]*?)(?=\s+(?:and|today|now|please|by|with|without|on foot)\b|[,.!?]|$)/,
    )?.[1]
    ?.trim();
  let candidates = allowed;
  let area = "";
  const exactNames = allowed.filter((r) =>
    affirmativeText.includes(normalize(r.name)),
  );
  if (zip) {
    candidates = filterDirectory(candidates, zip);
    area = zip;
  } else if (namedCities.length) {
    candidates = candidates.filter((r) =>
      namedCities.some((city) =>
        normalize(`${r.city ?? ""} ${r.address}`).includes(city),
      ),
    );
    area = namedCities.join(" / ");
  } else if (exactNames.length) {
    candidates = exactNames;
  } else if (place && !/^(?:me|here|my area|a hurry)$/.test(place)) {
    candidates = filterDirectory(candidates, place);
    area = place;
  } else if (
    text &&
    !general &&
    !/^(?:show (?:all|options)|near me|today|walking|bus|driving)$/.test(text)
  ) {
    candidates = filterDirectory(candidates, text);
  } else {
    const words = text
      .split(/[^a-z0-9]+/)
      .filter(
        (word) =>
          word.length > 2 &&
          !/^(?:food|foods|pantry|pantries|church|need|help|find|please|want|today|near|hungry|groceries|walking|driving|bus|the|and|for|some|can|you|have|meal|meals|eat|all)$/.test(
            word,
          ),
      );
    const named =
      general && words.length
        ? allowed.filter((r) =>
            words.every((word) => normalize(r.name).includes(word)),
          )
        : [];
    candidates = named.length
      ? named
      : !options.origin
        ? allowed.filter(pilot)
        : allowed;
  }

  const notices: string[] = [];
  if (blockedMode)
    notices.push(
      `You said ${mode === "walking" ? "walking" : mode === "transit" ? "taking a bus" : "driving"} does not work for you. Choose another travel option below your starting point. These pantry listings are not checked trips.`,
    );
  if (intent.service === "shelter") {
    candidates = [];
    notices.push(
      "Reach does not have verified shelter availability. Call 211 for shelter help. Food options below are a separate service.",
    );
  }
  if (intent.service === "prepared-meals") {
    candidates = candidates.filter(
      (r) =>
        /\b(?:prepared meals?|hot meals?|ready-to-eat meals?)\b/i.test(
          r.offering ?? "",
        ) && !/\b(?:no|not|unknown|unverified)\b/i.test(r.offering ?? ""),
    );
    if (!candidates.length)
      notices.push(
        "No prepared-meal service is verified in these results. The grocery pantries below may require cooking. Call 211 for meal options.",
      );
  }
  if (
    /\b(?:halal|kosher|vegan|gluten|allerg\w*|diapers?|wheelchair|no id|without id|identification)\b/.test(
      text,
    )
  )
    notices.push(
      "I cannot confirm that a pantry meets your dietary, ID, accessibility, or other specific requirement. Check visit details or call before going.",
    );
  const sorted = rankResources(candidates, { ...options, mode });
  // Prioritize an active recorded window, then the soonest future window, while
  // keeping proximity useful when an actual origin is selected.
  sorted.sort((a, b) => {
    const trust =
      Number(b.resource.verificationStatus === "confirmed-site") -
      Number(a.resource.verificationStatus === "confirmed-site");
    if (trust) return trust;
    const active =
      Number(b.summary.availabilityLabel === "Published distribution window") -
      Number(a.summary.availabilityLabel === "Published distribution window");
    if (active) return active;
    if (options.origin)
      return (
        (a.straightLineMiles ?? Infinity) - (b.straightLineMiles ?? Infinity) ||
        0
      );
    if (options.now)
      return (
        (Date.parse(
          nextPublishedWindow(a.resource, options.now)?.startsAt ?? "",
        ) || Infinity) -
          (Date.parse(
            nextPublishedWindow(b.resource, options.now)?.startsAt ?? "",
          ) || Infinity) || 0
      );
    return 0;
  });
  if (
    options.now &&
    /\b(?:today|now|hungry|urgent|asap)\b/.test(text) &&
    sorted.length
  ) {
    const localDay = (date: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    const today = localDay(options.now);
    if (
      !sorted.some(({ resource, summary }) => {
        if (summary.availabilityLabel === "Published distribution window")
          return true;
        if (
          (resource.communityHotspot ?? resource.communityOffer) &&
          Date.parse(
            (resource.communityHotspot ?? resource.communityOffer)!.startsAt,
          ) <= options.now!.getTime() &&
          Date.parse(
            (resource.communityHotspot ?? resource.communityOffer)!.endsAt,
          ) > options.now!.getTime()
        )
          return true;
        const next = nextPublishedWindow(resource, options.now!);
        return next && localDay(new Date(next.startsAt)) === today;
      })
    )
      notices.push(
        "I don’t have a confirmed pickup window left today in these results. Here are other published options. For help finding food today, call 211.",
      );
  }
  if (
    area &&
    !sorted.length &&
    intent.service !== "shelter" &&
    intent.service !== "prepared-meals"
  )
    notices.push(
      `I could not find a listed pantry matching “${area}”. Reach covers selected central Texas sites; this does not mean there is no help nearby.`,
    );
  if (!sorted.length && !notices.length)
    notices.push(
      "I could not match that request to the directory. Try a city, ZIP code, or pantry name, or browse the listed food options below.",
    );
  if (
    sorted[0]?.straightLineMiles !== undefined &&
    sorted[0].straightLineMiles > 30
  )
    notices.push(
      "The listed sites are far from your starting point. Call 211 for help closer to you; these are not confirmed practical trips.",
    );
  const alternatives = !sorted.length
    ? rankResources(
        allowed.filter((r) => options.origin || pilot(r)),
        { ...options, mode },
      ).slice(0, 3)
    : [];
  return {
    matches: sorted,
    alternatives,
    notices,
    area,
    mode,
    intent,
    blockedMode,
  };
}

/** Without an origin, Maps explicitly asks the visitor to choose one. */
export function foodDirectionsUrl(
  resource: Resource,
  origin: Coordinates | undefined,
  mode: TravelMode,
) {
  if (origin && !validCoordinates(origin))
    throw new RangeError("Choose a valid starting point.");
  if (origin && resource.coordinates)
    return googleMapsUrl(origin, resource.coordinates, mode);
  const params = new URLSearchParams({
    api: "1",
    ...(origin ? { origin: `${origin.lat},${origin.lng}` } : {}),
    destination: resource.coordinates
      ? `${resource.coordinates.lat},${resource.coordinates.lng}`
      : resource.address,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
