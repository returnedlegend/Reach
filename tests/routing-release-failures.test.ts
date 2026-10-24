import { afterEach, describe, expect, it, vi } from "vitest";
import { computeOsmJourney } from "../src/lib/osm-services";
import { accessJourneyLookup } from "../src/lib/access-routing";
import { accessInput } from "./fixtures/access-scenarios";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("release routing failure boundaries", () => {
  it("propagates the configured timeout signal and returns a private-detail-free unavailable result", async () => {
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla");
    vi.stubEnv("OSM_ROUTER_URL", "https://routing.example.invalid");
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => controller.signal);
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("secret-upstream-diagnostic")),
            { once: true },
          );
          queueMicrotask(() => controller.abort());
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await computeOsmJourney({
      origin: { lat: 30.61123, lng: -96.34123 },
      destination: { lat: 30.62123, lng: -96.35123 },
      mode: "walking",
    });
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(result).toMatchObject({ status: "unavailable", reason: "network" });
    expect(JSON.stringify(result)).not.toContain("secret-upstream");
  });
  it("stops at twelve external calls and reports budget exhaustion without inventing an itinerary", async () => {
    const route = vi.fn(async () => ({
      status: "available" as const,
      distanceMiles: 0.5,
      durationMinutes: 10,
      label: "Synthetic response",
      steps: [],
      paths: [],
      attribution: [],
    }));
    const adapter = accessJourneyLookup(accessInput({ mode: "walking" }), {
      route,
    });
    for (let i = 0; i < 12; i++)
      expect(
        await adapter.lookup(
          { lat: 30, lng: -96 },
          { lat: 30.01 + i / 1000, lng: -96.01 },
          480,
          720,
        ),
      ).toHaveLength(1);
    expect(
      await adapter.lookup(
        { lat: 30, lng: -96 },
        { lat: 30.03, lng: -96.02 },
        480,
        720,
      ),
    ).toEqual([]);
    expect(route).toHaveBeenCalledTimes(12);
    expect(adapter.exhausted()).toBe(true);
    expect(adapter.messages().join(" ")).toContain("budget");
  });
});
