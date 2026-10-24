// Server routes only. Never expose provider configuration as NEXT_PUBLIC_*.
import { z } from "zod";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import type { MapAttribution, MapPath } from "./map-types";

const REQUEST_LIMIT = 8192;
const RESPONSE_LIMIT = 512 * 1024;
const TIMEOUT_MS = 8000;
const INTERVAL_MS = 1100;
const MAX_PENDING = 4;
const CACHE_LIMIT = 128;
const attribution: MapAttribution[] = [
  {
    label: "© OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
  },
];
export const coordinatesSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();
export const journeyRequestSchema = z
  .object({
    origin: coordinatesSchema,
    destination: coordinatesSchema,
    mode: z.enum(["walking", "driving", "transit"]),
    missedBus: z.boolean().optional(),
  })
  .strict();
export const geocodeRequestSchema = z
  .object({ address: z.string().trim().min(3).max(500) })
  .strict();
export const reverseGeocodeRequestSchema = z
  .object({ coordinates: coordinatesSchema })
  .strict();
export type JourneyRequest = z.infer<typeof journeyRequestSchema>;
export type UnavailableReason =
  | "credentials"
  | "quota"
  | "no-route"
  | "network"
  | "provider"
  | "configuration";
export type Unavailable = {
  status: "unavailable";
  message: string;
  reason: UnavailableReason;
};
export type JourneyResult =
  | Unavailable
  | {
      status: "available";
      distanceMiles: number;
      durationMinutes: number;
      label: string;
      steps: { instruction: string }[];
      paths: MapPath[];
      attribution: MapAttribution[];
    };
export type GeocodeResult =
  | Unavailable
  | {
      status: "available";
      candidates: {
        label: string;
        coordinates: z.infer<typeof coordinatesSchema>;
      }[];
      attribution: MapAttribution[];
    };
export function unavailable(
  message: string,
  reason: UnavailableReason = "provider",
): Unavailable {
  return { status: "unavailable", message, reason };
}
function failure(reason: UnavailableReason, service: "routing" | "search") {
  const explanation = {
    credentials: "authorization is unavailable",
    quota: "request limit reached; try again later",
    "no-route":
      service === "search" ? "found no matching place" : "found no route",
    network: "could not connect; try again later",
    provider: "returned an unusable response",
    configuration: "is not configured for this deployment",
  }[reason];
  return unavailable(
    `${service === "routing" ? "Routing" : "Address search"} ${explanation}. ${service === "routing" ? "Use the published timetable and confirm service before travel." : "Choose a landmark or use your location."}`,
    reason,
  );
}
class BodyTooLarge extends Error {}
class LimiterFailure extends Error {
  constructor(public reason: "quota" | "configuration") {
    super(reason);
  }
}
async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<unknown> {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(part.value);
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export async function readOsmRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
) {
  try {
    const parsed = schema.safeParse(
      await boundedJson(request.body, REQUEST_LIMIT),
    );
    if (!parsed.success) throw new Error("Invalid fields");
    return { ok: true as const, data: parsed.data };
  } catch (error) {
    return {
      ok: false as const,
      response: osmResponse(
        unavailable(
          error instanceof BodyTooLarge
            ? "Request is too large."
            : "Check the request fields and try again.",
        ),
        error instanceof BodyTooLarge ? 413 : 400,
      ),
    };
  }
}
export function osmResponse(
  body: JourneyResult | GeocodeResult,
  status?: number,
) {
  return Response.json(body, {
    status:
      status ??
      (body.status === "available" ? 200 : body.reason === "quota" ? 429 : 503),
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Memory only: bounded LRU, five-minute positive / thirty-second negative entries.
// A hash avoids keeping an extra copy of search text in cache keys. Values never touch disk.
const globalState = globalThis as typeof globalThis & {
  __reachOsm?: {
    cache: Map<string, { until: number; value: JourneyResult | GeocodeResult }>;
    pending: Map<string, number>;
    inflight: Map<string, Promise<JourneyResult | GeocodeResult>>;
  };
};
const state = (globalState.__reachOsm ??= {
  cache: new Map(),
  pending: new Map(),
  inflight: new Map(),
});
state.inflight ??= new Map(); // Preserve development hot-reload compatibility.
// Coalesce identical simultaneous submissions without an unbounded task list.
async function coalesce<T extends JourneyResult | GeocodeResult>(
  key: string,
  service: "search" | "routing",
  work: () => Promise<T>,
): Promise<T> {
  const existing = state.inflight.get(key);
  if (existing) return structuredClone(await existing) as T;
  if (state.inflight.size >= CACHE_LIMIT) return failure("quota", service) as T;
  const pending = work();
  state.inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    state.inflight.delete(key);
  }
}
function cacheKey(...parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function cached<T extends JourneyResult | GeocodeResult>(
  key: string,
): T | undefined {
  const item = state.cache.get(key);
  if (!item) return;
  state.cache.delete(key);
  if (item.until <= Date.now()) return;
  state.cache.set(key, item);
  return structuredClone(item.value) as T;
}
function remember<T extends JourneyResult | GeocodeResult>(
  key: string,
  value: T,
): T {
  if (value.status === "available" || value.reason === "no-route") {
    if (state.cache.size >= CACHE_LIMIT)
      state.cache.delete(state.cache.keys().next().value!);
    state.cache.set(key, {
      until: Date.now() + (value.status === "available" ? 300000 : 30000),
      value: structuredClone(value),
    });
  }
  return value;
}
function multiInstance() {
  return [
    "VERCEL",
    "AWS_LAMBDA_FUNCTION_NAME",
    "NETLIFY",
    "FUNCTIONS_WORKER_RUNTIME",
    "K_SERVICE",
    "CF_PAGES",
    "RENDER",
    "FLY_APP_NAME",
    "DYNO",
  ].some((name) => Boolean(process.env[name]));
}
function providerBase(raw: string) {
  const url = new URL(raw);
  // DNS permits an optional final dot; public-host policy uses the canonical host.
  if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        local &&
        process.env.OSM_ALLOW_LOCALHOST === "true" &&
        url.protocol === "http:"
      )) ||
    (local && process.env.OSM_ALLOW_LOCALHOST !== "true")
  )
    throw new Error("Invalid provider base");
  return url;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
// Atomic filesystem lock + numeric timestamps coordinate all Node workers on one host.
// No stale-lock takeover: a crashed or malformed limiter fails closed for operator repair.
async function withPublicSlot<T>(
  namespace: string,
  work: () => Promise<T>,
): Promise<T> {
  const count = state.pending.get(namespace) ?? 0;
  if (count >= MAX_PENDING) throw new LimiterFailure("quota");
  state.pending.set(namespace, count + 1);
  const uid = process.getuid?.();
  const dir = `/tmp/reach-osm-${uid ?? "node"}-${namespace}`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  const lockPath = `${dir}/lock`;
  try {
    await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(dir);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (uid !== undefined && info.uid !== uid) ||
      info.mode & 0o077
    )
      throw new LimiterFailure("configuration");
    const deadline = Date.now() + TIMEOUT_MS;
    while (!lock) {
      try {
        lock = await open(
          lockPath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await lstat(lockPath).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return undefined;
          },
        );
        if (
          info &&
          (!info.isFile() ||
            info.isSymbolicLink() ||
            (uid !== undefined && info.uid !== uid))
        )
          throw new LimiterFailure("configuration");
        if (Date.now() >= deadline) throw new LimiterFailure("quota");
        await pause(25);
      }
    }
    let last = 0;
    try {
      const file = await open(
        `${dir}/timestamp`,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.size > 32 ||
          (uid !== undefined && info.uid !== uid)
        )
          throw new Error("Invalid limiter state");
        const value = await file.readFile("utf8");
        if (!/^\d{1,16}$/.test(value)) throw new Error("Invalid limiter state");
        last = Number(value);
        if (!Number.isSafeInteger(last) || last > Date.now() + INTERVAL_MS)
          throw new Error("Invalid limiter clock");
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const wait = Math.max(0, last + INTERVAL_MS - Date.now());
    if (Date.now() + wait > deadline) throw new LimiterFailure("quota");
    if (wait) await pause(wait);
    const temp = `${dir}/timestamp-${process.pid}`;
    const stamp = await open(
      temp,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await stamp.writeFile(String(Date.now()));
    } finally {
      await stamp.close();
    }
    await rename(temp, `${dir}/timestamp`);
    // Hold the lock until headers arrive: a delayed process cannot reorder dispatches.
    return await work();
  } catch (error) {
    if (error instanceof LimiterFailure) throw error;
    throw new LimiterFailure("configuration");
  } finally {
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
    state.pending.set(namespace, (state.pending.get(namespace) ?? 1) - 1);
  }
}
function httpReason(status: number): UnavailableReason {
  return status === 401 || status === 403
    ? "credentials"
    : status === 429
      ? "quota"
      : "provider";
}
async function providerRequest(
  url: URL,
  service: "search" | "routing",
  namespace?: string,
  body?: unknown,
): Promise<unknown | Unavailable> {
  const userAgent =
    process.env.OSM_USER_AGENT?.trim() ||
    "Reach/0.1 (https://github.com/returnedlegend/Reach)";
  if (
    userAgent.length > 300 ||
    /[\r\n]/.test(userAgent) ||
    !/(https?:\/\/\S+|[^\s]+@[^\s]+\.[^\s]+)/.test(userAgent)
  )
    return failure("configuration", service);
  const work = async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
        headers: {
          "User-Agent": userAgent,
          ...(namespace === "valhalla-demo"
            ? {
                "X-Client-Id":
                  "Reach (https://github.com/returnedlegend/Reach)",
              }
            : {}),
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return failure("network", service);
    }
    if (!response.ok) {
      if (service === "routing" && response.status === 400) {
        try {
          const body = await boundedJson(response.body, RESPONSE_LIMIT);
          if (
            body &&
            typeof body === "object" &&
            "error_code" in body &&
            [171, 442, 443, 444].includes(Number(body.error_code))
          )
            return body;
        } catch {
          /* Invalid provider error response. */
        }
      }
      await response.body?.cancel();
      return failure(httpReason(response.status), service);
    }
    try {
      return await boundedJson(response.body, RESPONSE_LIMIT);
    } catch {
      return failure("provider", service);
    }
  };
  try {
    return namespace ? await withPublicSlot(namespace, work) : await work();
  } catch (error) {
    return failure(
      error instanceof LimiterFailure ? error.reason : "configuration",
      service,
    );
  }
}
function isUnavailable(value: unknown): value is Unavailable {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      value.status === "unavailable",
  );
}
const placeSchema = z.object({
  display_name: z.string().min(1).max(2000),
  lat: z
    .string()
    .max(30)
    .regex(/^-?\d+(?:\.\d+)?$/),
  lon: z
    .string()
    .max(30)
    .regex(/^-?\d+(?:\.\d+)?$/),
});
async function findPlace(
  input: string | z.infer<typeof coordinatesSchema>,
): Promise<GeocodeResult> {
  let base: URL;
  try {
    base = providerBase(
      process.env.OSM_GEOCODER_URL?.trim() ||
        "https://nominatim.openstreetmap.org",
    );
    if (
      base.hostname === "nominatim.openstreetmap.org" &&
      (process.env.OSM_NOMINATIM_SINGLE_INSTANCE !== "true" || multiInstance())
    )
      return failure("configuration", "search");
  } catch {
    return failure("configuration", "search");
  }
  const publicHost = base.hostname === "nominatim.openstreetmap.org";
  const key = cacheKey("geocode", base.href, input);
  const hit = cached<GeocodeResult>(key);
  if (hit) return hit;
  const url = new URL(typeof input === "string" ? "/search" : "/reverse", base);
  url.searchParams.set("format", "jsonv2");
  if (typeof input === "string") {
    url.searchParams.set("q", input);
    url.searchParams.set("limit", "5");
  } else {
    url.searchParams.set("lat", String(input.lat));
    url.searchParams.set("lon", String(input.lng));
  }
  const body = await providerRequest(
    url,
    "search",
    publicHost ? "nominatim" : undefined,
  );
  if (isUnavailable(body)) return body;
  try {
    if (
      typeof input !== "string" &&
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error === "Unable to geocode"
    )
      return remember(key, failure("no-route", "search"));
    const places = z
      .array(placeSchema)
      .max(100)
      .parse(typeof input === "string" ? body : [body]);
    if (!places.length) return remember(key, failure("no-route", "search"));
    const candidates = places.slice(0, 5).map((place) => ({
      label: place.display_name,
      coordinates: coordinatesSchema.parse({
        lat: Number(place.lat),
        lng: Number(place.lon),
      }),
    }));
    return remember(key, { status: "available", candidates, attribution });
  } catch {
    return failure("provider", "search");
  }
}
export const geocodeOsmAddress = (address: string) =>
  coalesce(
    cacheKey("forward-pending", process.env.OSM_GEOCODER_URL, address.trim()),
    "search",
    () => findPlace(address.trim()),
  );
export const reverseGeocodeOsm = (
  coordinates: z.infer<typeof coordinatesSchema>,
) =>
  coalesce(
    cacheKey("reverse-pending", process.env.OSM_GEOCODER_URL, coordinates),
    "search",
    () => findPlace(coordinates),
  );

const summarySchema = z.object({
  length: z.number().finite().min(0).max(100000),
  time: z.number().finite().min(0).max(10000000),
});
const maneuverSchema = z.object({
  instruction: z.string().min(1).max(2000),
  begin_shape_index: z.number().int().min(0),
  end_shape_index: z.number().int().min(0),
});
const tripSchema = z.object({
  trip: z.object({
    status: z.literal(0),
    units: z.literal("miles"),
    summary: summarySchema,
    legs: z
      .array(
        z.object({
          summary: summarySchema,
          shape: z.string().min(1).max(200000),
          maneuvers: z.array(maneuverSchema).min(1).max(1000),
        }),
      )
      .min(1)
      .max(10),
  }),
});
// Valhalla uses precision 6; MapLibre/GeoJSON expects longitude before latitude.
export function decodePolyline6(encoded: string): [number, number][] {
  let cursor = 0,
    lat = 0,
    lng = 0;
  const points: [number, number][] = [];
  const delta = () => {
    let result = 0,
      shift = 0;
    while (true) {
      if (cursor >= encoded.length || shift > 30)
        throw new Error("Invalid shape");
      const value = encoded.charCodeAt(cursor++) - 63;
      if (value < 0 || value > 63) throw new Error("Invalid shape");
      result += (value & 31) * 2 ** shift;
      shift += 5;
      if (value < 32) return result % 2 ? -(result + 1) / 2 : result / 2;
    }
  };
  while (cursor < encoded.length) {
    lat += delta();
    lng += delta();
    const point = coordinatesSchema.parse({ lat: lat / 1e6, lng: lng / 1e6 });
    points.push([point.lng, point.lat]);
    if (points.length > 50000) throw new Error("Shape too large");
  }
  if (points.length < 2) throw new Error("Incomplete shape");
  return points;
}
function milesBetween(
  a: JourneyRequest["origin"],
  b: JourneyRequest["origin"],
) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
async function computeJourney(input: JourneyRequest): Promise<JourneyResult> {
  if (input.mode === "transit")
    return unavailable(
      "Live transit routing is unavailable. Use the published local timetable and confirm service before travel.",
      "no-route",
    );
  const mode = process.env.OSM_ROUTER_MODE ?? "disabled";
  const demo = mode === "valhalla-demo";
  let base: URL;
  try {
    if (mode !== "valhalla" && !demo)
      return failure("configuration", "routing");
    base = providerBase(
      demo
        ? "https://valhalla1.openstreetmap.de"
        : process.env.OSM_ROUTER_URL || "",
    );
    if (base.hostname === "valhalla1.openstreetmap.de" && !demo)
      return failure("configuration", "routing");
    if (demo && multiInstance()) return failure("configuration", "routing");
  } catch {
    return failure("configuration", "routing");
  }
  if (demo && milesBetween(input.origin, input.destination) > 100)
    return unavailable(
      "The community routing demo is limited to trips within 100 miles. Use a configured routing service for longer journeys.",
      "configuration",
    );
  const key = cacheKey(
    "route",
    base.href,
    input.origin,
    input.destination,
    input.mode,
  );
  const hit = cached<JourneyResult>(key);
  if (hit) return hit;
  const body = await providerRequest(
    new URL("/route", base),
    "routing",
    demo ? "valhalla-demo" : undefined,
    {
      locations: [input.origin, input.destination].map(({ lat, lng }) => ({
        lat,
        lon: lng,
      })),
      costing: input.mode === "walking" ? "pedestrian" : "auto",
      units: "miles",
      language: "en-US",
      shape_format: "polyline6",
    },
  );
  if (isUnavailable(body)) return body;
  if (
    body &&
    typeof body === "object" &&
    "error_code" in body &&
    [171, 442, 443, 444].includes(Number(body.error_code))
  )
    return remember(key, failure("no-route", "routing"));
  try {
    const { trip } = tripSchema.parse(body);
    const paths: MapPath[] = trip.legs.map((leg, index) => {
      const coordinates = decodePolyline6(leg.shape);
      if (
        leg.maneuvers.some(
          (step) =>
            step.end_shape_index < step.begin_shape_index ||
            step.end_shape_index >= coordinates.length,
        )
      )
        throw new Error("Invalid maneuver indices");
      return {
        id: `osm-${index}`,
        mode: input.mode as "walking" | "driving",
        coordinates,
        label: `OSM ${input.mode} route`,
      };
    });
    const sumLength = trip.legs.reduce(
      (sum, leg) => sum + leg.summary.length,
      0,
    );
    const sumTime = trip.legs.reduce((sum, leg) => sum + leg.summary.time, 0);
    if (
      Math.abs(sumLength - trip.summary.length) >
        Math.max(0.05, trip.summary.length * 0.01) ||
      Math.abs(sumTime - trip.summary.time) > 5
    )
      throw new Error("Inconsistent summary");
    const first = paths[0].coordinates[0],
      last = paths.at(-1)!.coordinates.at(-1)!;
    if (
      milesBetween(input.origin, { lng: first[0], lat: first[1] }) > 1 ||
      milesBetween(input.destination, { lng: last[0], lat: last[1] }) > 1
    )
      throw new Error("Shape does not reach endpoints");
    return remember(key, {
      status: "available",
      distanceMiles: trip.summary.length,
      durationMinutes: trip.summary.time / 60,
      steps: trip.legs.flatMap((leg) =>
        leg.maneuvers.map(({ instruction }) => ({ instruction })),
      ),
      paths,
      attribution: [
        ...attribution,
        {
          label: demo ? "Routing: Valhalla / FOSSGIS" : "Routing: Valhalla",
          url: demo
            ? "https://routing.openstreetmap.de/about.html"
            : "https://valhalla.github.io/valhalla/",
        },
        {
          label: "Improve the map",
          url: "https://www.openstreetmap.org/fixthemap",
        },
      ],
      label: `Valhalla ${input.mode} estimate${demo ? " · community demo; no production SLA" : ""}`,
    });
  } catch {
    return failure("provider", "routing");
  }
}
export const computeOsmJourney = (
  input: JourneyRequest,
): Promise<JourneyResult> =>
  coalesce(
    cacheKey(
      "route-pending",
      process.env.OSM_ROUTER_MODE,
      process.env.OSM_ROUTER_URL,
      input,
    ),
    "routing",
    () => computeJourney(input),
  );
