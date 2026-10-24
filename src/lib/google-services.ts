import { z } from "zod";

// Import this module only from server routes. Never expose this key as NEXT_PUBLIC_*.
const REQUEST_LIMIT = 8192;
const RESPONSE_LIMIT = 512 * 1024;
const TIMEOUT_MS = 8000;
const routesEndpoint =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const geocodingEndpoint = "https://maps.googleapis.com/maps/api/geocode/json";

export const coordinatesSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export const journeyRequestSchema = z
  .object({
    origin: coordinatesSchema,
    destination: coordinatesSchema,
    mode: z.enum(["walking", "transit", "driving"]),
    missedBus: z.boolean().optional(),
  })
  .strict();
export const geocodeRequestSchema = z
  .object({ address: z.string().trim().min(3).max(500) })
  .strict();

export type JourneyRequest = z.infer<typeof journeyRequestSchema>;
export type UnavailableReason =
  | "credentials"
  | "quota"
  | "no-route"
  | "network"
  | "provider";
export type Unavailable = {
  status: "unavailable";
  message: string;
  reason?: UnavailableReason;
};
export type JourneyResult =
  | Unavailable
  | {
      status: "available";
      distanceMiles: number;
      durationMinutes: number;
      polyline?: string;
      steps?: { instruction: string }[];
      label: string;
    };
export type GeocodeResult =
  | Unavailable
  | {
      status: "available";
      candidates: {
        label: string;
        coordinates: { lat: number; lng: number };
      }[];
    };

export function unavailable(
  message: string,
  reason?: UnavailableReason,
): Unavailable {
  return { status: "unavailable", message, ...(reason ? { reason } : {}) };
}

function httpFailureReason(status: number): UnavailableReason {
  if (status === 401 || status === 403) return "credentials";
  if (status === 429) return "quota";
  return "provider";
}

function routeUnavailableMessage(reason: UnavailableReason): string {
  switch (reason) {
    case "credentials":
      return "Google routing authorization is unavailable. Open directions in Google Maps or use the published timetable.";
    case "quota":
      return "Google routing request limit reached. Try again later or open directions in Google Maps.";
    case "network":
      return "Could not connect to Google routing. Check your connection or open directions in Google Maps.";
    case "no-route":
      return "Google could not find a route. Check directions in Google Maps and confirm service before travel.";
    case "provider":
      return "Google could not return a route. Check directions in Google Maps and confirm service before travel.";
  }
}

function geocodeUnavailableMessage(reason: UnavailableReason): string {
  switch (reason) {
    case "credentials":
      return "Address search authorization is unavailable. Choose a landmark or use your location.";
    case "quota":
      return "Address search request limit reached. Try again later, choose a landmark, or use your location.";
    case "network":
      return "Could not connect to address search. Check your connection, choose a landmark, or use your location.";
    case "no-route":
      return "No address candidates were found. Refine the address, choose a landmark, or use your location.";
    case "provider":
      return "Address search is unavailable. Refine the address, choose a landmark, or use your location.";
  }
}

class BodyTooLarge extends Error {}

// Bound actual streamed bytes, including requests without Content-Length.
async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}

export async function readGoogleRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
) {
  try {
    const data = schema.safeParse(
      await boundedJson(request.body, REQUEST_LIMIT),
    );
    if (!data.success) throw new Error("Invalid request");
    return { ok: true as const, data: data.data };
  } catch (error) {
    const tooLarge = error instanceof BodyTooLarge;
    return {
      ok: false as const,
      response: googleResponse(
        unavailable(
          tooLarge
            ? "Request is too large."
            : "Check the request fields and try again.",
        ),
        tooLarge ? 413 : 400,
      ),
    };
  }
}

export function googleResponse(
  body: JourneyResult | GeocodeResult,
  status?: number,
) {
  return Response.json(body, {
    status: status ?? (body.status === "available" ? 200 : 503),
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const metersSchema = z.number().finite().min(0).max(100_000_000);
const durationSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,9})?s$/)
  .refine((v) => Number(v.slice(0, -1)) <= 10_000_000);
const timestampSchema = z.iso
  .datetime({ offset: true })
  .refine((v) => Number.isFinite(Date.parse(v)));
const transitDetailsSchema = z.object({
  stopDetails: z.object({
    departureStop: z.object({ name: z.string().min(1).max(500) }),
    arrivalStop: z.object({ name: z.string().min(1).max(500) }),
    departureTime: timestampSchema,
    arrivalTime: timestampSchema,
  }),
  transitLine: z
    .object({
      name: z.string().min(1).max(500).optional(),
      nameShort: z.string().min(1).max(100).optional(),
    })
    .refine((v) => Boolean(v.name || v.nameShort)),
  headsign: z.string().min(1).max(500).optional(),
});
const stepSchema = z.object({
  travelMode: z
    .enum([
      "WALK",
      "TRANSIT",
      "DRIVE",
      "BICYCLE",
      "TWO_WHEELER",
      "TRAVEL_MODE_UNSPECIFIED",
    ])
    .optional(),
  distanceMeters: metersSchema.optional(),
  staticDuration: durationSchema.optional(),
  navigationInstruction: z
    .object({ instructions: z.string().min(1).max(2000) })
    .optional(),
  transitDetails: transitDetailsSchema.optional(),
});
const routeSchema = z.object({
  distanceMeters: metersSchema,
  duration: durationSchema,
  polyline: z
    .object({
      encodedPolyline: z
        .string()
        .min(1)
        .max(200_000)
        .regex(/^[?-~]+$/),
    })
    .optional(),
  legs: z
    .array(
      z.object({
        steps: z.array(stepSchema).max(1000).optional(),
      }),
    )
    .max(50)
    .optional(),
});

const chicagoTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function transitInstructions(
  steps: z.infer<typeof stepSchema>[],
  readyAt: number,
) {
  let earliest = readyAt;
  let rides = 0;
  const instructions: { instruction: string }[] = [];
  for (const step of steps) {
    if (step.travelMode === "WALK") {
      if (
        step.distanceMeters === undefined ||
        !step.staticDuration ||
        !step.navigationInstruction
      )
        throw new Error("Incomplete walking segment");
      earliest += Number(step.staticDuration.slice(0, -1)) * 1000;
      instructions.push({
        instruction: `Walk: ${step.navigationInstruction.instructions} (${(step.distanceMeters / 1609.344).toFixed(2)} miles, ${Math.ceil(Number(step.staticDuration.slice(0, -1)) / 60)} minutes).`,
      });
    } else if (step.travelMode === "TRANSIT" && step.transitDetails) {
      const { stopDetails, transitLine, headsign } = step.transitDetails;
      const departure = Date.parse(stopDetails.departureTime);
      const arrival = Date.parse(stopDetails.arrivalTime);
      const earliestBoarding = earliest + (rides ? 5 * 60 * 1000 : 0);
      if (departure < earliestBoarding || arrival < departure)
        throw new Error("Invalid transit sequence");
      const line = [transitLine.nameShort, transitLine.name]
        .filter(Boolean)
        .join(" · ");
      instructions.push({
        instruction: `${rides ? "Transfer: board" : "Board"} ${line}${headsign ? ` toward ${headsign}` : ""} at ${stopDetails.departureStop.name}, ${chicagoTime.format(departure)}. Get off at ${stopDetails.arrivalStop.name}, ${chicagoTime.format(arrival)}.${rides ? " Allow at least 5 minutes to board after transfer walking." : ""} Google transit estimate; confirm service.`,
      });
      earliest = arrival;
      rides++;
    } else {
      throw new Error("Incomplete transit segment");
    }
  }
  if (!rides) throw new Error("No transit itinerary");
  return instructions;
}

export async function computeGoogleJourney(
  input: JourneyRequest,
): Promise<JourneyResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
  if (!key)
    return unavailable(
      "Google routing is not configured. Open directions in Google Maps or use the published timetable.",
      "credentials",
    );
  const waypoint = (point: JourneyRequest["origin"]) => ({
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  });
  const readyAt = Date.now() + 2 * 60 * 1000;
  try {
    let response: Response;
    try {
      response = await fetch(routesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails.stopDetails,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.headsign",
        },
        body: JSON.stringify({
          origin: waypoint(input.origin),
          destination: waypoint(input.destination),
          travelMode: { walking: "WALK", transit: "TRANSIT", driving: "DRIVE" }[
            input.mode
          ],
          ...(input.mode === "transit"
            ? { departureTime: new Date(readyAt).toISOString() }
            : {}),
          languageCode: "en-US",
          computeAlternativeRoutes: false,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return unavailable(routeUnavailableMessage("network"), "network");
    }
    if (!response.ok) {
      const reason = httpFailureReason(response.status);
      return unavailable(routeUnavailableMessage(reason), reason);
    }
    const body = await boundedJson(response.body, RESPONSE_LIMIT);
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0
    )
      return unavailable(routeUnavailableMessage("no-route"), "no-route");
    const parsed = z
      .object({ routes: z.array(routeSchema).max(10) })
      .safeParse(body);
    if (!parsed.success) throw new Error("Invalid route");
    if (!parsed.data.routes.length)
      return unavailable(routeUnavailableMessage("no-route"), "no-route");
    const route = parsed.data.routes[0];
    const segments = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    const steps =
      input.mode === "transit"
        ? transitInstructions(segments, readyAt)
        : segments.flatMap((step) =>
            step.navigationInstruction
              ? [{ instruction: step.navigationInstruction.instructions }]
              : [],
          );
    return {
      status: "available",
      distanceMiles: route.distanceMeters / 1609.344,
      durationMinutes: Number(route.duration.slice(0, -1)) / 60,
      ...(route.polyline ? { polyline: route.polyline.encodedPolyline } : {}),
      ...(steps?.length ? { steps } : {}),
      label:
        input.mode === "transit"
          ? `Google transit estimate · ${input.missedBus ? "recalculated; " : ""}departure after 2-minute ready buffer; confirm service`
          : `Google ${input.mode} route estimate`,
    };
  } catch {
    // Do not log addresses, coordinates, response bodies, or credential-bearing URLs.
    return unavailable(routeUnavailableMessage("provider"), "provider");
  }
}

const geocodeResponseSchema = z.object({
  status: z.literal("OK"),
  results: z
    .array(
      z.object({
        formatted_address: z.string().min(1).max(1000),
        geometry: z.object({ location: coordinatesSchema }),
      }),
    )
    .min(1)
    .max(100),
});

const geocodeUnavailableReason: Record<string, UnavailableReason> = {
  ZERO_RESULTS: "no-route",
  OVER_QUERY_LIMIT: "quota",
  REQUEST_DENIED: "credentials",
  OVER_DAILY_LIMIT: "credentials",
};

export async function geocodeGoogleAddress(
  address: string,
): Promise<GeocodeResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
  if (!key)
    return unavailable(
      "Address search is not configured. Choose a landmark or use your location.",
      "credentials",
    );
  const url = new URL(geocodingEndpoint);
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return unavailable(geocodeUnavailableMessage("network"), "network");
    }
    if (!response.ok) {
      const reason = httpFailureReason(response.status);
      return unavailable(geocodeUnavailableMessage(reason), reason);
    }
    const body = await boundedJson(response.body, RESPONSE_LIMIT);
    if (
      body &&
      typeof body === "object" &&
      "status" in body &&
      typeof body.status === "string" &&
      body.status !== "OK"
    ) {
      return unavailable(
        geocodeUnavailableMessage(
          geocodeUnavailableReason[body.status] ?? "provider",
        ),
        geocodeUnavailableReason[body.status] ?? "provider",
      );
    }
    const parsed = geocodeResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("Invalid geocoding response");
    return {
      status: "available",
      candidates: parsed.data.results.slice(0, 5).map((result) => ({
        label: result.formatted_address,
        coordinates: result.geometry.location,
      })),
    };
  } catch {
    return unavailable(geocodeUnavailableMessage("provider"), "provider");
  }
}
