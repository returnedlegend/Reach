import { afterEach, describe, expect, it, vi } from "vitest";
import { computeOsmJourney } from "../src/lib/osm-services";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("production demonstration provider guard", () => {
  it("fails before any request when demo mode is inherited into production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla-demo");
    vi.stubEnv("REACH_ENVIRONMENT", "production");
    vi.stubEnv("REACH_ROUTER_DEMO_ACKNOWLEDGED", "true");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await computeOsmJourney({
      origin: { lat: 30.67, lng: -96.37 },
      destination: { lat: 30.68, lng: -96.38 },
      mode: "walking",
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "configuration",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires an explicit preview acknowledgement even for a preview environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OSM_ROUTER_MODE", "valhalla-demo");
    vi.stubEnv("REACH_ENVIRONMENT", "preview");
    vi.stubEnv("REACH_ROUTER_DEMO_ACKNOWLEDGED", "false");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      await computeOsmJourney({
        origin: { lat: 30.67, lng: -96.37 },
        destination: { lat: 30.68, lng: -96.38 },
        mode: "walking",
      }),
    ).toMatchObject({ status: "unavailable", reason: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
