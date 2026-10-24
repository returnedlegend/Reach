import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as journey } from "../src/app/api/journey/route";
import { POST as geocode } from "../src/app/api/geocode/route";
import { POST as reverse } from "../src/app/api/reverse-geocode/route";
import { decodePolyline6 } from "../src/lib/osm-services";

// Exercise the actual lock algorithm without touching an application's real /tmp limiter.
const disk = vi.hoisted(() => ({
  files: new Map<string, { data: string; directory: boolean; mode: number }>(),
  broken: false,
}));
vi.mock("node:fs/promises", async () => {
  const { constants } = await import("node:fs");
  const error = (code: string) => Object.assign(new Error(code), { code });
  const stat = (path: string) => {
    const file = disk.files.get(path);
    if (!file) throw error("ENOENT");
    return {
      isDirectory: () => file.directory,
      isFile: () => !file.directory,
      isSymbolicLink: () => false,
      uid: process.getuid?.(),
      mode: file.mode,
      size: file.data.length,
    };
  };
  return {
    mkdir: async (path: string) => {
      if (disk.broken) throw error("EACCES");
      if (disk.files.has(path)) throw error("EEXIST");
      disk.files.set(path, { data: "", directory: true, mode: 0o700 });
    },
    lstat: async (path: string) => stat(path),
    open: async (path: string, flags: number) => {
      if (flags & constants.O_CREAT) {
        if (disk.files.has(path)) throw error("EEXIST");
        disk.files.set(path, { data: "", directory: false, mode: 0o600 });
      } else if (!disk.files.has(path)) throw error("ENOENT");
      return {
        close: async () => {},
        stat: async () => stat(path),
        readFile: async () => disk.files.get(path)!.data,
        writeFile: async (data: string) => {
          disk.files.get(path)!.data = data;
        },
      };
    },
    rename: async (from: string, to: string) => {
      disk.files.set(to, disk.files.get(from)!);
      disk.files.delete(from);
    },
    unlink: async (path: string) => {
      if (!disk.files.delete(path)) throw error("ENOENT");
    },
  };
});
const trip = {
  origin: { lat: 30.61, lng: -96.34 },
  destination: { lat: 30.62, lng: -96.35 },
  mode: "walking",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const result = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});
function encode(points: number[][]) {
  let lat = 0,
    lng = 0;
  let value = "";
  for (const [x, y] of points) {
    for (let delta of [Math.round(y * 1e6) - lat, Math.round(x * 1e6) - lng]) {
      delta = delta < 0 ? -delta * 2 - 1 : delta * 2;
      while (delta >= 32) {
        value += String.fromCharCode((delta % 32) + 32 + 63);
        delta = Math.floor(delta / 32);
      }
      value += String.fromCharCode(delta + 63);
    }
    lat = Math.round(y * 1e6);
    lng = Math.round(x * 1e6);
  }
  return value;
}
const shape = encode([
  [-96.34, 30.61],
  [-96.345, 30.615],
  [-96.35, 30.62],
]);
function route() {
  return {
    trip: {
      status: 0,
      units: "miles",
      summary: { length: 1.25, time: 900 },
      legs: [
        {
          summary: { length: 1.25, time: 900 },
          shape,
          maneuvers: [
            {
              instruction: "Walk along the path.",
              begin_shape_index: 0,
              end_shape_index: 2,
            },
          ],
        },
      ],
    },
  };
}
const place = {
  display_name: "Fictional place, Texas",
  lat: "30.61",
  lon: "-96.34",
};

describe("OSM server adapters (mocked providers)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    for (const key of [
      "OSM_GEOCODER_URL",
      "OSM_ROUTER_URL",
      "OSM_ROUTER_MODE",
      "OSM_NOMINATIM_SINGLE_INSTANCE",
      "OSM_USER_AGENT",
      "OSM_ALLOW_LOCALHOST",
      "VERCEL",
      "AWS_LAMBDA_FUNCTION_NAME",
      "NETLIFY",
      "FUNCTIONS_WORKER_RUNTIME",
      "K_SERVICE",
      "CF_PAGES",
      "RENDER",
      "FLY_APP_NAME",
      "DYNO",
    ])
      vi.stubEnv(key, "");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    disk.files.clear();
    disk.broken = false;
    const state = (
      globalThis as unknown as {
        __reachOsm: {
          cache: Map<string, unknown>;
          pending: Map<string, number>;
        };
      }
    ).__reachOsm;
    state.cache.clear();
    state.pending.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function configured() {
    vi.stubEnv("OSM_GEOCODER_URL", "https://geocoder.example");
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla");
    vi.stubEnv("OSM_ROUTER_URL", "https://router.example");
  }
  it("defaults disabled without contacting a provider and never exposes stored responses", async () => {
    for (const response of [
      await journey(request(trip)),
      await geocode(request({ address: "Fictional place" })),
      await reverse(request({ coordinates: trip.origin })),
    ]) {
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect((await result(response)).body).toMatchObject({
        status: "unavailable",
        reason: "configuration",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { ...trip, origin: { lat: 91, lng: 0 } },
    { ...trip, destination: { lat: 0, lng: -181 } },
    { ...trip, origin: { lat: "30", lng: 0 } },
    { ...trip, mode: "bike" },
    { ...trip, origin: { ...trip.origin, url: "https://attacker.example" } },
    { ...trip, url: "https://attacker.example" },
  ])("rejects invalid coordinates or unknown request fields", async (input) => {
    expect((await journey(request(input))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds streamed request bytes even without Content-Length", async () => {
    expect((await geocode(request({ address: "x".repeat(9000) }))).status).toBe(
      413,
    );
    expect(
      (await reverse(request({ coordinates: { lat: 1, lng: 2, extra: true } })))
        .status,
    ).toBe(400);
  });
  it("uses explicit forward/reverse search on one configured endpoint, with correct coordinate order and attribution", async () => {
    configured();
    fetchMock
      .mockResolvedValueOnce(Response.json([place]))
      .mockResolvedValueOnce(Response.json(place));
    expect(
      (await result(await geocode(request({ address: "Fictional place" }))))
        .body,
    ).toMatchObject({
      status: "available",
      candidates: [{ coordinates: trip.origin }],
      attribution: [{ label: "© OpenStreetMap contributors" }],
    });
    expect(
      (await result(await reverse(request({ coordinates: trip.origin })))).body,
    ).toMatchObject({
      status: "available",
      candidates: [{ coordinates: trip.origin }],
    });
    const forward = new URL(String(fetchMock.mock.calls[0][0])),
      backward = new URL(String(fetchMock.mock.calls[1][0]));
    expect(forward.origin).toBe("https://geocoder.example");
    expect(forward.pathname).toBe("/search");
    expect(backward.origin).toBe(forward.origin);
    expect(backward.pathname).toBe("/reverse");
    expect(backward.searchParams.get("lat")).toBe("30.61");
    expect(backward.searchParams.get("lon")).toBe("-96.34");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: {
        "User-Agent": expect.stringContaining(
          "github.com/returnedlegend/Reach",
        ),
      },
    });
  });
  it.each([
    [401, "credentials"],
    [403, "credentials"],
    [429, "quota"],
    [500, "provider"],
  ])("classifies HTTP %s as %s", async (status, reason) => {
    configured();
    fetchMock.mockImplementation(async () =>
      Response.json({}, { status: Number(status) }),
    );
    for (const response of [
      await geocode(request({ address: "Somewhere" })),
      await journey(request(trip)),
    ])
      expect((await response.json()).reason).toBe(reason);
  });
  it("classifies network errors without leaking upstream details", async () => {
    configured();
    fetchMock.mockRejectedValue(new Error("secret-coordinate-url"));
    const response = await result(await journey(request(trip)));
    expect(response.body.reason).toBe("network");
    expect(JSON.stringify(response.body)).not.toContain(
      "secret-coordinate-url",
    );
  });
  it("rejects oversized, malformed, and invalid-coordinate provider data", async () => {
    configured();
    for (const body of [
      "x".repeat(513 * 1024),
      "{bad",
      JSON.stringify([{ ...place, lat: "91" }]),
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(body));
      expect(
        (await (await geocode(request({ address: "Somewhere" }))).json())
          .reason,
      ).toBe("provider");
    }
  });
  it("caches positive and negative results, expires negative cache, and bounds memory", async () => {
    configured();
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json([]));
    for (let i = 0; i < 2; i++)
      expect(
        (await (await geocode(request({ address: "No such place" }))).json())
          .reason,
      ).toBe("no-route");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30001);
    await geocode(request({ address: "No such place" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => Response.json([place]));
    await geocode(request({ address: "A real place" }));
    await geocode(request({ address: "A real place" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 135; i++)
      await geocode(request({ address: `Place ${i}` }));
    const state = (
      globalThis as unknown as { __reachOsm: { cache: Map<string, unknown> } }
    ).__reachOsm;
    expect(state.cache.size).toBeLessThanOrEqual(128);
  });
  it("uses real Valhalla pedestrian/auto costing, miles, seconds, polyline6, and GeoJSON paths", async () => {
    configured();
    fetchMock.mockImplementation(async () => Response.json(route()));
    for (const mode of ["walking", "driving"]) {
      const response = await result(await journey(request({ ...trip, mode })));
      expect(response.body).toMatchObject({
        status: "available",
        distanceMiles: 1.25,
        durationMinutes: 15,
        steps: [{ instruction: "Walk along the path." }],
        paths: [
          {
            mode,
            coordinates: [
              [-96.34, 30.61],
              [-96.345, 30.615],
              [-96.35, 30.62],
            ],
          },
        ],
      });
      const call = fetchMock.mock.calls.at(-1)!;
      expect(String(call[0])).toBe("https://router.example/route");
      expect(JSON.parse(call[1]!.body as string)).toMatchObject({
        costing: mode === "walking" ? "pedestrian" : "auto",
        units: "miles",
        shape_format: "polyline6",
        locations: [
          { lat: 30.61, lon: -96.34 },
          { lat: 30.62, lon: -96.35 },
        ],
      });
    }
  });
  it("does not invent a transit route or use Google", async () => {
    configured();
    expect(
      (await (await journey(request({ ...trip, mode: "transit" }))).json())
        .reason,
    ).toBe("no-route");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("handles Valhalla no-path error bodies and caches them", async () => {
    configured();
    fetchMock.mockResolvedValueOnce(
      Response.json({ error_code: 442, error: "No path" }, { status: 400 }),
    );
    for (let i = 0; i < 2; i++)
      expect((await (await journey(request(trip))).json()).reason).toBe(
        "no-route",
      );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete summaries, wrong units, shapes, maneuver indices, and inconsistent totals", async () => {
    configured();
    const inputs = [route(), route(), route(), route(), route()];
    delete (
      inputs[0].trip.summary as Partial<(typeof inputs)[0]["trip"]["summary"]>
    ).time;
    inputs[1].trip.units = "kilometers";
    inputs[2].trip.legs[0].shape = "?";
    inputs[3].trip.legs[0].maneuvers[0].end_shape_index = 100;
    inputs[4].trip.summary.length = 100;
    for (const body of inputs) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect((await (await journey(request(trip))).json()).reason).toBe(
        "provider",
      );
    }
    expect(() => decodePolyline6("????????")).not.toThrow();
    expect(() => decodePolyline6("?")).toThrow();
  });
  it.each([
    "https://user:password@geocoder.example",
    "https://geocoder.example/search",
    "https://geocoder.example?secret=yes",
    "http://geocoder.example",
    "http://localhost:7070",
  ])("rejects unsafe server provider configuration %s", async (url) => {
    vi.stubEnv("OSM_GEOCODER_URL", url);
    expect(
      (await (await geocode(request({ address: "A place" }))).json()).reason,
    ).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows explicit local development servers only with an extra opt-in", async () => {
    vi.stubEnv("OSM_GEOCODER_URL", "http://localhost:7070");
    vi.stubEnv("OSM_ALLOW_LOCALHOST", "true");
    fetchMock.mockResolvedValueOnce(Response.json([place]));
    expect(
      (await (await geocode(request({ address: "A place" }))).json()).status,
    ).toBe("available");
  });
  it("refuses public services in known multi-instance deployments, even with an opt-in", async () => {
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla-demo");
    vi.stubEnv("VERCEL", "1");
    for (const response of [
      await geocode(request({ address: "A place" })),
      await journey(request(trip)),
    ])
      expect((await response.json()).reason).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("serializes public forward and reverse calls at >=1100ms, caches repeats, and writes only timestamps", async () => {
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    vi.useFakeTimers();
    const dispatches: number[] = [];
    fetchMock.mockImplementation(async (url) => {
      dispatches.push(Date.now());
      return Response.json(
        new URL(String(url)).pathname === "/search" ? [place] : place,
      );
    });
    const a = geocode(request({ address: "A place" }));
    const b = reverse(request({ coordinates: trip.origin }));
    await vi.advanceTimersByTimeAsync(2200);
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(dispatches[1] - dispatches[0]).toBeGreaterThanOrEqual(1100);
    await geocode(request({ address: "A place" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [path, file] of disk.files) {
      if (path.endsWith("timestamp")) expect(file.data).toMatch(/^\d+$/);
      expect(file.data).not.toContain("30.61");
    }
  });
  it("bounds the public queue and fails closed when filesystem locking is unavailable", async () => {
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => Response.json([]));
    const work = Array.from({ length: 4 }, (_, i) =>
      geocode(request({ address: `Place ${i}` })),
    );
    const overflow = await geocode(request({ address: "Overflow place" }));
    expect(overflow.status).toBe(429);
    expect((await overflow.json()).reason).toBe("quota");
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all(work);
    disk.broken = true;
    expect(
      (await (await geocode(request({ address: "Another place" }))).json())
        .reason,
    ).toBe("configuration");
  });
  it("coalesces simultaneous identical public submissions", async () => {
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    fetchMock.mockImplementation(async () => Response.json([place]));
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => geocode(request({ address: "A place" }))),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("canonicalizes public hostnames before applying opt-in policy", async () => {
    vi.stubEnv("OSM_GEOCODER_URL", "https://NOMINATIM.OPENSTREETMAP.ORG.");
    expect(
      (await (await geocode(request({ address: "A place" }))).json()).reason,
    ).toBe("configuration");
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla");
    vi.stubEnv("OSM_ROUTER_URL", "https://valhalla1.openstreetmap.de.");
    expect((await (await journey(request(trip))).json()).reason).toBe(
      "configuration",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed on corrupted persistent limiter timestamps", async () => {
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    const dir = `/tmp/reach-osm-${process.getuid?.() ?? "node"}-nominatim`;
    disk.files.set(dir, { data: "", directory: true, mode: 0o700 });
    disk.files.set(`${dir}/timestamp`, {
      data: "broken state",
      directory: false,
      mode: 0o600,
    });
    expect(
      (await (await geocode(request({ address: "A place" }))).json()).reason,
    ).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires an identifying provider User-Agent", async () => {
    configured();
    vi.stubEnv("OSM_USER_AGENT", "GenericBot");
    expect(
      (await (await geocode(request({ address: "A place" }))).json()).reason,
    ).toBe("configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("limits community demo distance and dispatch rate and labels its availability caveat", async () => {
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla-demo");
    vi.useFakeTimers();
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return Response.json(route());
    });
    const a = journey(request(trip));
    const b = journey(request({ ...trip, mode: "driving" }));
    await vi.advanceTimersByTimeAsync(2200);
    expect((await (await a).json()).label).toContain(
      "community demo; no production SLA",
    );
    await b;
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1100);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "X-Client-Id": expect.stringContaining("Reach"),
    });
    expect(
      (
        await (
          await journey(
            request({ ...trip, destination: { lat: 40, lng: -70 } }),
          )
        ).json()
      ).reason,
    ).toBe("configuration");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
