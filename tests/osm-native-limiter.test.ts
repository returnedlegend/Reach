import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { geocodeOsmAddress } from "../src/lib/osm-services";

// Use actual OS filesystem permissions; the adapter's in-memory fs tests cannot
// reveal Windows' lack of POSIX permission bits or a hardcoded /tmp path.
const environment = vi.hoisted(() => ({ directory: "" }));
vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, tmpdir: () => environment.directory || os.tmpdir() };
});
environment.directory = mkdtempSync(
  join(tmpdir(), "reach-native-limiter-test-"),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => {
  rmSync(environment.directory, { recursive: true, force: true });
});

describe("native OSM public limiter", () => {
  it("uses the OS temporary directory and succeeds with native permissions", async () => {
    vi.stubEnv("OSM_GEOCODER_URL", "https://nominatim.openstreetmap.org");
    vi.stubEnv("OSM_NOMINATIM_SINGLE_INSTANCE", "true");
    for (const name of [
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
      vi.stubEnv(name, "");
    const provider = vi.fn(async () =>
      Response.json([
        {
          display_name: "Synthetic provider fixture",
          lat: "30.61",
          lon: "-96.34",
        },
      ]),
    );
    vi.stubGlobal("fetch", provider);
    const result = await geocodeOsmAddress(
      "Synthetic native filesystem test location",
    );
    expect(result.status).toBe("available");
    expect(provider).toHaveBeenCalledTimes(1);
    const [directory] = readdirSync(environment.directory);
    expect(directory).toMatch(/^reach-osm-/);
    const state = join(environment.directory, directory);
    expect(readdirSync(state)).toEqual(["timestamp"]);
    expect(readFileSync(join(state, "timestamp"), "utf8")).toMatch(/^\d+$/);
  });
});
