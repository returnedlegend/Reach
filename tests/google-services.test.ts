import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Optional legacy adapter tests; production endpoints now use OSM providers.
import { computeGoogleJourney, geocodeGoogleAddress, readGoogleRequest, journeyRequestSchema, geocodeRequestSchema, googleResponse } from "../src/lib/google-services";
async function journey(request: Request) {
  const parsed = await readGoogleRequest(request, journeyRequestSchema);
  return parsed.ok ? googleResponse(await computeGoogleJourney(parsed.data)) : parsed.response;
}
async function geocode(request: Request) {
  const parsed = await readGoogleRequest(request, geocodeRequestSchema);
  return parsed.ok ? googleResponse(await geocodeGoogleAddress(parsed.data.address)) : parsed.response;
}

const trip = {
  origin: { lat: 30.61, lng: -96.34 },
  destination: { lat: 30.62, lng: -96.35 },
  mode: "walking",
};
function transitRoute() {
  const walk = (instructions: string, duration: string) => ({
    travelMode: "WALK",
    distanceMeters: 200,
    staticDuration: duration,
    navigationInstruction: { instructions },
  });
  const ride = (
    nameShort: string,
    from: string,
    to: string,
    departure: string,
    arrival: string,
  ) => ({
    travelMode: "TRANSIT",
    transitDetails: {
      stopDetails: {
        departureStop: { name: from },
        arrivalStop: { name: to },
        departureTime: departure,
        arrivalTime: arrival,
      },
      transitLine: { nameShort, name: `Fictional line ${nameShort}` },
      headsign: "Fictional downtown",
    },
  });
  return {
    distanceMeters: 5000,
    duration: "2100s",
    legs: [
      {
        steps: [
          walk("Approach Fictional A", "120s"),
          ride(
            "12",
            "Fictional A",
            "Fictional B",
            "2026-06-18T15:28:00Z",
            "2026-06-18T15:38:00Z",
          ),
          walk("Cross to Fictional C", "120s"),
          ride(
            "20",
            "Fictional C",
            "Fictional D",
            "2026-06-18T15:46:00Z",
            "2026-06-18T15:56:00Z",
          ),
          walk("Continue to the pantry entrance", "180s"),
        ],
      },
    ],
  };
}
const request = (body: unknown) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("server Google adapters (mocked providers, no real Google integration)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-private-key");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns explicit unavailable without contacting Google when the key is absent", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "");
    for (const response of [
      await journey(request(trip)),
      await geocode(request({ address: "A fictional address" })),
    ]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "unavailable",
        message: expect.any(String),
        reason: "credentials",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...trip, origin: { lat: 91, lng: 0 } },
    { ...trip, destination: { lat: 0, lng: -181 } },
    { ...trip, origin: { lat: "30", lng: 0 } },
    { ...trip, origin: { lat: null, lng: 0 } },
    { ...trip, mode: "bike" },
    { ...trip, missedBus: "true" },
    { ...trip, url: "https://attacker.invalid/" },
    {
      ...trip,
      destination: { lat: 0, lng: 0, url: "https://attacker.invalid/" },
    },
  ])("rejects invalid coordinates, modes, or extra input %#", async (body) => {
    const response = await journey(request(body));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a nonfinite JSON numeric value and malformed JSON", async () => {
    for (const body of [
      '{"origin":{"lat":1e999,"lng":0},"destination":{"lat":0,"lng":0},"mode":"walking"}',
      "{",
    ]) {
      expect(
        (
          await journey(
            new Request("http://localhost/", { method: "POST", body }),
          )
        ).status,
      ).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds actual UTF-8 bytes without relying on Content-Length", async () => {
    const body = JSON.stringify({ address: "é".repeat(4100) });
    expect(body.length).toBeLessThan(8192);
    const response = await geocode(
      new Request("http://localhost/", { method: "POST", body }),
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses routed metrics and a fixed endpoint, bounded request, field mask, and no caching", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        routes: [
          {
            distanceMeters: 1609.344,
            duration: "600.5s",
            polyline: { encodedPolyline: "ipkcFfichVnP@j@BLoFVwM{E?" },
            legs: [
              {
                steps: [
                  {
                    navigationInstruction: {
                      instructions: "Walk along the path.",
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const response = await journey(request(trip));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "available",
      distanceMiles: 1,
      durationMinutes: 600.5 / 60,
      label: "Google walking route estimate",
      steps: [{ instruction: "Walk along the path." }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
    );
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      redirect: "error",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe(
      "test-private-key",
    );
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toContain(
      "routes.distanceMeters",
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({
      travelMode: "WALK",
      origin: { location: { latLng: { latitude: 30.61, longitude: -96.34 } } },
    });
    expect(JSON.parse(init?.body as string)).not.toHaveProperty(
      "departureTime",
    );
  });

  it("recomputes transit using server time and labels it an estimate, including missed-bus requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T15:22:00.000Z"));
    fetchMock.mockImplementation(async () =>
      Response.json({ routes: [transitRoute()] }),
    );
    for (const missedBus of [false, true]) {
      const response = await journey(
        request({ ...trip, mode: "transit", missedBus }),
      );
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(result.label).toContain("transit estimate");
      expect(result.label).toContain("2-minute ready buffer");
      expect(result.label).not.toMatch(/live|real.time/i);
      const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
      expect(body).toMatchObject({
        travelMode: "TRANSIT",
        departureTime: new Date(Date.now() + 120_000).toISOString(),
      });
      expect(body).not.toHaveProperty("missedBus");
      vi.advanceTimersByTime(60_000);
    }
  });

  it("preserves ordered approach, boarding, transfers, alighting and final walk with Chicago estimated times", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T15:22:00Z"));
    fetchMock.mockResolvedValue(Response.json({ routes: [transitRoute()] }));
    const response = await journey(request({ ...trip, mode: "transit" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.durationMinutes).toBe(35);
    expect(result.steps).toHaveLength(5);
    expect(result.steps[0].instruction).toContain(
      "Approach Fictional A (0.12 miles, 2 minutes)",
    );
    expect(result.steps[1].instruction).toContain(
      "Board 12 · Fictional line 12 toward Fictional downtown at Fictional A, Jun 18, 10:28 AM CDT",
    );
    expect(result.steps[1].instruction).toContain(
      "Get off at Fictional B, Jun 18, 10:38 AM CDT",
    );
    expect(result.steps[2].instruction).toContain("Cross to Fictional C");
    expect(result.steps[3].instruction).toContain("Transfer: board 20");
    expect(result.steps[3].instruction).toContain(
      "Fictional C, Jun 18, 10:46 AM CDT",
    );
    expect(result.steps[4].instruction).toContain(
      "Continue to the pantry entrance",
    );
    const mask = new Headers(fetchMock.mock.calls[0][1]?.headers).get(
      "X-Goog-FieldMask",
    );
    expect(mask).toContain("routes.legs.steps.transitDetails.stopDetails");
    expect(mask).toContain("routes.legs.steps.staticDuration");
  });

  it.each([
    { sameStop: true, departure: "15:38:00", expectedStatus: 503 },
    { sameStop: true, departure: "15:42:59", expectedStatus: 503 },
    { sameStop: true, departure: "15:43:00", expectedStatus: 200 },
    { sameStop: false, departure: "15:40:00", expectedStatus: 503 },
    { sameStop: false, departure: "15:44:59", expectedStatus: 503 },
    { sameStop: false, departure: "15:45:00", expectedStatus: 200 },
  ])(
    "requires five boarding minutes in addition to transfer walking: %j",
    async ({ sameStop, departure, expectedStatus }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-18T15:22:00Z"));
      const route = transitRoute();
      const steps = route.legs[0].steps;
      const nextRide = steps[3];
      if (!("transitDetails" in nextRide))
        throw new Error("Invalid test fixture");
      nextRide.transitDetails.stopDetails.departureTime = `2026-06-18T${departure}Z`;
      if (sameStop) {
        nextRide.transitDetails.stopDetails.departureStop.name = "Fictional B";
        steps.splice(2, 1);
      }
      fetchMock.mockResolvedValue(Response.json({ routes: [route] }));
      const response = await journey(request({ ...trip, mode: "transit" }));
      expect(response.status).toBe(expectedStatus);
      const result = await response.json();
      if (expectedStatus === 200) {
        expect(
          result.steps.find((step: { instruction: string }) =>
            step.instruction.startsWith("Transfer:"),
          )?.instruction,
        ).toContain("Allow at least 5 minutes to board after transfer walking");
      } else {
        expect(result.status).toBe("unavailable");
        expect(result).not.toHaveProperty("durationMinutes");
      }
    },
  );

  it.each([
    "missing legs",
    "missing line",
    "missing stops",
    "missing time",
    "invalid time",
    "past departure",
    "impossible transfer",
    "missing walk duration",
    "no ride",
  ])(
    "refuses an incomplete or unusable transit itinerary: %s",
    async (defect) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-18T15:22:00Z"));
      // Deliberately mutate external JSON to exercise provider validation.
      const route = transitRoute() as unknown as Record<string, any>;
      const steps = route.legs[0].steps;
      if (defect === "missing legs") delete route.legs;
      if (defect === "missing line") delete steps[1].transitDetails.transitLine;
      if (defect === "missing stops")
        delete steps[1].transitDetails.stopDetails.departureStop;
      if (defect === "missing time")
        delete steps[1].transitDetails.stopDetails.arrivalTime;
      if (defect === "invalid time")
        steps[1].transitDetails.stopDetails.arrivalTime = "yesterday";
      if (defect === "past departure")
        steps[1].transitDetails.stopDetails.departureTime =
          "2026-06-18T15:23:00Z";
      if (defect === "impossible transfer")
        steps[3].transitDetails.stopDetails.departureTime =
          "2026-06-18T15:39:00Z";
      if (defect === "missing walk duration") delete steps[0].staticDuration;
      if (defect === "no ride") route.legs[0].steps = [steps[0]];
      fetchMock.mockResolvedValue(Response.json({ routes: [route] }));
      const response = await journey(request({ ...trip, mode: "transit" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "unavailable",
        message: expect.any(String),
        reason: "provider",
      });
    },
  );

  it.each([
    {},
    { routes: [] },
    { routes: [{ distanceMeters: -5, duration: "60s" }] },
    { routes: [{ distanceMeters: 500, duration: "not-a-duration" }] },
    { routes: [{ distanceMeters: 500, duration: "99999999999999999999s" }] },
    { routes: [{ distanceMeters: "500", duration: "60s" }] },
    {
      routes: [
        {
          distanceMeters: 500,
          duration: "60s",
          polyline: { encodedPolyline: "<script>" },
        },
      ],
    },
  ])(
    "does not invent route metrics from malformed provider response %#",
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body));
      const response = await journey(request(trip));
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("durationMinutes");
      expect(result).not.toHaveProperty("distanceMiles");
    },
  );

  it("classifies credential, quota, network, and provider failures without exposing details", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("private provider error test-private-key", { status: 403 }),
    );
    const denied = await journey(request(trip));
    expect(denied.status).toBe(503);
    const deniedResult = await denied.json();
    expect(deniedResult).toMatchObject({
      reason: "credentials",
      message: expect.stringContaining("authorization is unavailable"),
    });
    expect(JSON.stringify(deniedResult)).not.toContain("test-private-key");
    fetchMock.mockRejectedValueOnce(
      new DOMException("test-private-key", "TimeoutError"),
    );
    const timeout = await journey(request(trip));
    expect(timeout.status).toBe(503);
    expect(await timeout.json()).toMatchObject({
      reason: "network",
      message: expect.stringContaining("Could not connect"),
    });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    const quota = await journey(request(trip));
    expect(quota.status).toBe(503);
    expect(await quota.json()).toMatchObject({
      reason: "quota",
      message: expect.stringContaining("request limit reached"),
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({ invalid: "provider payload" }),
    );
    const malformed = await journey(request(trip));
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).toMatchObject({ reason: "provider" });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: "REQUEST_DENIED",
        error_message: "test-private-key",
      }),
    );
    const unavailable = await geocode(
      request({ address: "A fictional address" }),
    );
    expect(unavailable.status).toBe(503);
    const deniedGeocode = await unavailable.json();
    expect(deniedGeocode).toMatchObject({
      reason: "credentials",
      message: expect.stringContaining("authorization is unavailable"),
    });
    expect(JSON.stringify(deniedGeocode)).not.toContain("test-private-key");
  });

  it("classifies empty route responses and documented geocoding statuses", async () => {
    for (const body of [{}, { routes: [] }]) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect(await (await journey(request(trip))).json()).toMatchObject({
        status: "unavailable",
        reason: "no-route",
        message: expect.stringContaining("could not find a route"),
      });
    }
    for (const [status, reason] of [
      ["ZERO_RESULTS", "no-route"],
      ["OVER_QUERY_LIMIT", "quota"],
      ["REQUEST_DENIED", "credentials"],
    ]) {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          status,
          results: [],
          error_message: "private test key",
        }),
      );
      const response = await geocode(
        request({ address: "A fictional address" }),
      );
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result).toMatchObject({
        reason,
        message: expect.stringContaining(
          reason === "no-route"
            ? "No address candidates were found"
            : reason === "quota"
              ? "request limit reached"
              : "authorization is unavailable",
        ),
      });
      expect(JSON.stringify(result)).not.toContain("private test key");
    }
  });

  it("does not accept an oversized upstream response", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(512 * 1024 + 1)));
    expect((await journey(request(trip))).status).toBe(503);
  });

  it("returns all matching candidates for explicit user selection without automatically setting an origin", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Fictional first match",
            geometry: { location: { lat: 30, lng: -96 } },
          },
          {
            formatted_address: "Fictional second match",
            geometry: { location: { lat: 31, lng: -97 } },
          },
        ],
      }),
    );
    const response = await geocode(
      request({ address: "  Fictional & address  " }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "available",
      candidates: [
        { label: "Fictional first match", coordinates: { lat: 30, lng: -96 } },
        { label: "Fictional second match", coordinates: { lat: 31, lng: -97 } },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );
    expect(parsed.searchParams.get("address")).toBe("Fictional & address");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  });

  it.each([
    { status: "OK", results: [] },
    {
      status: "OK",
      results: [
        {
          formatted_address: "Wrong latitude",
          geometry: { location: { lat: 91, lng: 0 } },
        },
      ],
    },
  ])("handles malformed geocoding candidates %#", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    const response = await geocode(request({ address: "A fictional address" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      message: expect.any(String),
      reason: "provider",
    });
  });

  it.each([
    { address: " " },
    { address: 42 },
    { address: "a".repeat(501) },
    { address: "Example", url: "https://attacker.invalid" },
  ])("rejects invalid address input %#", async (body) => {
    expect((await geocode(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
