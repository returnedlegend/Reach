import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

// Independent integration checks. The real MapLibre renderer uses a neutral
// fixture background; all GPS fixes and intercepted routes are synthetic.
// These tests establish UI/state behavior, never real route safety or uptime.
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [{ id: "qa-background", type: "background" }],
          },
        })
      : route.abort("blockedbyclient"),
  );
});

type GeoHarness = {
  calls: string[];
  cleared: number[];
  emit: (lat: number, lng: number, age?: number) => void;
  fail: () => void;
};
declare global {
  interface Window {
    __tx10Geo: GeoHarness;
  }
}

async function controlledGps(page: Page, denyOnce = false) {
  await page.addInitScript(({ denyOnce }) => {
    let success: PositionCallback | undefined;
    let failure: PositionErrorCallback | null | undefined;
    let watchId = 116;
    const denied = {
      code: 1,
      message: "Synthetic permission denial",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
    const state: GeoHarness = {
      calls: [],
      cleared: [],
      emit(lat, lng, age = 0) {
        success?.({
          coords: {
            latitude: lat,
            longitude: lng,
            accuracy: 45,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now() - age,
        } as GeolocationPosition);
      },
      fail() {
        failure?.(denied);
      },
    };
    window.__tx10Geo = state;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(ok: PositionCallback, error: PositionErrorCallback) {
          state.calls.push("once");
          if (denyOnce) error(denied);
          else {
            success = ok;
            state.emit(30.6501234, -96.3505678);
          }
        },
        watchPosition(ok: PositionCallback, error: PositionErrorCallback) {
          state.calls.push("watch");
          success = ok;
          failure = error;
          return ++watchId;
        },
        clearWatch(id: number) {
          state.cleared.push(id);
          // Retain callbacks deliberately: late browser deliveries must be ignored.
        },
      },
    });
  }, { denyOnce });
}

async function locationStep(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const picker = page.getByRole("region", { name: "Choose a starting location" });
  await picker.getByText("Advanced: enter coordinates", { exact: true }).click();
  return picker;
}

test("GPS is opt-in and permission denial preserves precise manual entry", async ({ page }) => {
  await controlledGps(page, true);
  const picker = await locationStep(page);
  expect(await page.evaluate(() => window.__tx10Geo.calls)).toEqual([]);
  await picker.getByRole("button", { name: "Use my location", exact: true }).click();
  await expect(picker).toContainText("Location permission was denied");
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Travel choices", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__tx10Geo.calls)).toEqual(["once"]);
});

test("location follow clears its watch on stop, manual replacement and unmount and ignores late fixes", async ({ page }) => {
  await controlledGps(page);
  const picker = await locationStep(page);
  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await page.evaluate(() => window.__tx10Geo.emit(30.6501234, -96.3505678));
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("30.6501234");
  await picker.getByRole("button", { name: "Stop following", exact: true }).click();
  expect(await page.evaluate(() => window.__tx10Geo.cleared)).toEqual([117]);
  await page.evaluate(() => window.__tx10Geo.emit(31, -97));
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("30.6501234");

  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6602345");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3606789");
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
  expect(await page.evaluate(() => window.__tx10Geo.cleared)).toEqual([117, 118]);
  await page.evaluate(() => window.__tx10Geo.emit(31, -97));
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("30.6602345");

  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect(await page.evaluate(() => window.__tx10Geo.cleared)).toEqual([117, 118, 119]);
});

test("old or denied follow fixes stop the watch without replacing the chosen point", async ({ page }) => {
  await controlledGps(page);
  const picker = await locationStep(page);
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await page.evaluate(() => window.__tx10Geo.emit(31, -97, 180_000));
  await expect(picker).toContainText("old location");
  await expect(picker.getByRole("button", { name: "Follow my location", exact: true })).toBeVisible();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("30.6501234");
  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await page.evaluate(() => window.__tx10Geo.fail());
  await expect(picker).toContainText("Location permission was denied");
  expect(await page.evaluate(() => window.__tx10Geo.cleared)).toEqual([117, 118]);
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("30.6501234");
});

type JourneyBody = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: string;
};

async function foodOptions(page: Page) {
  const picker = await locationStep(page);
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Where would you like to go?", { exact: true }).selectOption("bridge-ministries");
  await page.getByLabel("How will you travel?", { exact: true }).selectOption("walking");
  await page.getByRole("button", { name: "Show my options", exact: true }).click();
}

async function embeddedDirections(page: Page) {
  await foodOptions(page);
  await page.getByRole("button", { name: "Pantry information & busy times", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Pantry information", exact: true });
  await dialog.getByRole("button", { name: /^Get directions$/i })
    .or(dialog.getByRole("link", { name: /^Get directions$/i })).click();
  await expect(dialog).toHaveCount(0);
  return page.getByRole("region", { name: "Trip directions", exact: true });
}

async function fixtureJourneys(page: Page, bodies: JourneyBody[]) {
  await page.route("**/api/journey", async (route) => {
    const body = route.request().postDataJSON() as JourneyBody;
    bodies.push(body);
    await route.fulfill({
      json: {
        status: "available",
        label: `Controlled ${body.mode} provider fixture`,
        message: "Synthetic route for integration checks only.",
        distanceMiles: 1.25,
        durationMinutes: body.mode === "walking" ? 25 : 5,
        steps: [{ instruction: `Controlled ${body.mode} provider instruction` }],
        paths: [{
          id: `qa-${body.mode}`,
          mode: body.mode,
          label: `Controlled ${body.mode} fixture geometry`,
          coordinates: [
            [body.origin.lng, body.origin.lat],
            [body.origin.lng + 0.001, body.origin.lat + 0.001],
            [body.destination.lng, body.destination.lat],
          ],
        }],
        attribution: [{ label: "Controlled OSM attribution", url: "https://www.openstreetmap.org/copyright" }],
      },
    });
  });
}

test("pantry Get directions stays in Reach and walking/driving retain exact endpoints and provider instructions", async ({ page }, testInfo) => {
  const bodies: JourneyBody[] = [];
  await fixtureJourneys(page, bodies);
  const directions = await embeddedDirections(page);
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  expect(bodies.at(-1)).toMatchObject({
    origin: { lat: 30.6501234, lng: -96.3505678 },
    destination: { lat: 30.6472913, lng: -96.3606034 },
    mode: "walking",
  });
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(map).toContainText("1 route line is provided.");
  await expect(map.getByRole("list", { name: "Map route legend" })).toContainText("Controlled walking fixture geometry");
  await page.getByRole("button", { name: "Browse places", exact: true }).click();
  await expect(directions).toBeHidden();
  await expect(map).toContainText("1 route line is provided.");
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(directions).toBeVisible();
  await page.getByRole("button", { name: /^Hide (resources|directions)/ }).click();
  await expect(directions).toBeHidden();
  await page.getByRole("button", { name: /^Show (resources|directions)/ }).click();
  await expect(directions).toBeVisible();
  await directions.getByLabel("How will you travel?", { exact: true }).selectOption("driving");
  await expect(directions.getByText("Controlled driving provider instruction", { exact: true })).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ mode: "driving", origin: bodies[0].origin, destination: bodies[0].destination });
  await expect(map.getByRole("list", { name: "Map route legend" })).toContainText("Controlled driving fixture geometry");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const accessibility = await new AxeBuilder({ page }).include('[aria-label="Trip directions"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("tx10-driving-directions-fixture.png"), fullPage: true });
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 740 });
    const widths = await page.evaluate(() => ({
      inner: innerWidth,
      visual: visualViewport?.width,
      page: document.documentElement.scrollWidth,
    }));
    expect(widths.inner).toBe(320);
    expect(widths.visual).toBeCloseTo(320, 0);
    expect(widths.page).toBeLessThanOrEqual(320);
    const endTarget = await directions.getByRole("button", { name: "End route", exact: true }).boundingBox();
    expect(endTarget!.width).toBeGreaterThanOrEqual(44);
    expect(endTarget!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("tx10-directions-320-fixture.png"), fullPage: true });
  }
});

test("standalone pantry directions use only pantry ID and mode in the URL", async ({ page }) => {
  const bodies: JourneyBody[] = [];
  await fixtureJourneys(page, bodies);
  await page.goto("/pantries/bridge-ministries");
  const appOrigin = new URL(page.url()).origin;
  await page.getByText("Choose a starting point", { exact: true }).click();
  const picker = page.getByRole("region", { name: "Choose a starting location" });
  await picker.getByText("Advanced: enter coordinates", { exact: true }).click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
  await page.getByRole("button", { name: /^Get directions$/i }).click();
  const directions = page.getByRole("region", { name: "Trip directions", exact: true });
  await expect(directions).toBeVisible();
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  const href = new URL(page.url());
  expect(href.origin).toBe(appOrigin);
  expect(href.pathname).toBe("/");
  expect(href.searchParams.get("directions")).toBe("bridge-ministries");
  expect(href.searchParams.get("mode")).toBe("walking");
  expect([...href.searchParams.keys()].sort()).toEqual(["directions", "mode"]);
  expect(bodies.at(-1)?.origin).toEqual({ lat: 30.6501234, lng: -96.3505678 });
  const persisted = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(persisted).not.toContain("30.6501234");
  expect(persisted).not.toContain("96.3505678");
});

test("current GPS fixes and metadata survive pantry details, stationary fixes preserve routes, and End cancels pending routing", async ({ page }) => {
  await controlledGps(page);
  const bodies: JourneyBody[] = [];
  await fixtureJourneys(page, bodies);
  const directions = await embeddedDirections(page);
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  await directions.getByText("Edit starting point", { exact: true }).click();
  const picker = directions.getByRole("region", { name: "Choose a starting location" });
  await picker.getByRole("button", { name: "Follow my location", exact: true }).click();
  await page.evaluate(() => window.__tx10Geo.emit(30.6602345, -96.3606789));
  await expect.poll(() => bodies.at(-1)?.origin).toEqual({ lat: 30.6602345, lng: -96.3606789 });
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__tx10Geo.emit(30.6602345, -96.3606789));
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  const renderer = map.getByRole("region", { name: "Interactive journey map", exact: true });
  await expect(renderer).toHaveAttribute("data-location-source", "gps");
  await expect(renderer).toHaveAttribute("data-accuracy-meters", "45");
  await page.getByRole("button", { name: "Browse places", exact: true }).click();
  await page.getByRole("region", { name: "Map resource list", exact: true })
    .getByRole("article", { name: "The Bridge Ministries Bryan", exact: true })
    .getByRole("button", { name: "Pantry information & busy times", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pantry information", exact: true });
  // An active watch may deliver another fix while the pantry dialog is open.
  await page.evaluate(() => window.__tx10Geo.emit(30.6652345, -96.3656789));
  await dialog.getByRole("button", { name: "Get directions", exact: true }).click();
  await expect.poll(() => bodies.at(-1)?.origin).toEqual({ lat: 30.6652345, lng: -96.3656789 });
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  await expect(renderer).toHaveAttribute("data-location-source", "gps");
  await expect(renderer).toHaveAttribute("data-accuracy-meters", "45");
  await expect(map).toContainText("Origin: Current location.");
  expect(await page.evaluate(() => window.__tx10Geo.calls.filter((call) => call === "watch").length)).toBe(1);
  await expect(map).toContainText("1 route line is provided.");
  const callsAtEnd = bodies.length;
  // End before a changed GPS point's 1.1-second reroute timer can fire.
  await page.evaluate(() => window.__tx10Geo.emit(30.6703456, -96.3707891));
  await directions.getByRole("button", { name: "End route", exact: true }).click();
  await expect(directions).toHaveCount(0);
  await expect(map).toContainText("No route line is provided.");
  await expect(map.getByRole("list", { name: "Map route legend" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__tx10Geo.cleared)).toEqual([117]);
  await page.evaluate(() => window.__tx10Geo.emit(31, -97));
  await page.getByRole("region", { name: "Map resource list", exact: true })
    .getByRole("button", { name: "Parkway Baptist", exact: true }).click();
  // Wait beyond the GPS debounce: canceled navigation must not restart.
  await page.waitForTimeout(1200);
  expect(bodies).toHaveLength(callsAtEnd);
  await expect(map).toContainText("No route line is provided.");
});

test("a failed recomputation clears the previous geometry and instructions and permits retry", async ({ page }) => {
  const bodies: JourneyBody[] = [];
  await fixtureJourneys(page, bodies);
  const directions = await embeddedDirections(page);
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toBeVisible();
  await page.route("**/api/journey", (route) => route.fulfill({
    status: 503,
    json: { status: "unavailable", reason: "network", message: "Controlled provider outage; no route." },
  }));
  await directions.getByLabel("How will you travel?", { exact: true }).selectOption("driving");
  await expect(directions).toContainText("Controlled provider outage; no route.");
  await expect(directions.getByText("Controlled walking provider instruction", { exact: true })).toHaveCount(0);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(map).toContainText("No route line is provided.");
  await expect(map.getByRole("list", { name: "Map route legend" })).toHaveCount(0);
  await page.unroute("**/api/journey");
  await fixtureJourneys(page, bodies);
  await directions.getByRole("button", { name: "Recalculate directions", exact: true }).click();
  await expect(directions.getByText("Controlled driving provider instruction", { exact: true })).toBeVisible();
  await expect(map).toContainText("1 route line is provided.");
});

test("the active pantry database retains every reviewed addition's exact point, schedule and source URLs", async ({ request }) => {
  type Candidate = {
    id: string;
    coordinates: { lat: number; lng: number } | null;
    hours: string;
    sources: { url: string }[];
  };
  const research: Candidate[] = ["tx10-brazos-candidates.json", "tx10-regional-candidates.json"]
    .flatMap((file) => JSON.parse(readFileSync(path.join(process.cwd(), "data/research", file), "utf8")));
  const boundary = JSON.parse(readFileSync(path.join(process.cwd(), "data/geo/tx10-119.geojson"), "utf8"));
  const rings: number[][][] = boundary.features[0].geometry.coordinates;
  // Independent ray-casting classification of sourced points, not county names.
  const inRing = (lat: number, lng: number, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  const candidates = research.filter(({ coordinates: c }) => c &&
    inRing(c.lat, c.lng, rings[0]) && !rings.slice(1).some((ring) => inRing(c.lat, c.lng, ring)));
  expect(candidates.length).toBeGreaterThan(8);
  expect(new Set(candidates.map((item) => item.id)).size).toBe(candidates.length);
  const response = await request.get("/api/pantries?pageSize=100");
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  for (const candidate of candidates) {
    const record = payload.pantries.find((item: Candidate) => item.id === candidate.id);
    expect(record, candidate.id).toBeDefined();
    expect(record.coordinates, `${candidate.id} point`).toEqual(candidate.coordinates);
    expect(record.hours, `${candidate.id} published schedule`).toBe(candidate.hours);
    expect(record.sources.map((source: { url: string }) => source.url), `${candidate.id} sources`)
      .toEqual(expect.arrayContaining(candidate.sources.map((source) => source.url)));
  }
  for (const excluded of research.filter((item) => !candidates.includes(item)))
    expect(payload.pantries.some((item: Candidate) => item.id === excluded.id), `${excluded.id} remains research only`).toBe(false);
});

test("coverage API serves the original district geometry and the optional overlay preserves the chosen origin", async ({ page, request }, testInfo) => {
  const source = JSON.parse(readFileSync(path.join(process.cwd(), "data/geo/tx10-119.geojson"), "utf8"));
  const response = await request.get("/api/coverage");
  expect(response.ok()).toBe(true);
  const coverage = await response.json();
  expect(coverage.geometry).toEqual(source.features[0].geometry);
  expect(coverage.properties).toMatchObject({ geoid: "4810", congress: "119th Congress" });
  expect(coverage.properties.sourceUrl).toBe("https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_48_cd119.zip");
  let browserCoverageRequests = 0;
  page.on("request", (item) => {
    if (new URL(item.url()).pathname === "/api/coverage") browserCoverageRequests++;
  });
  await foodOptions(page);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(map.getByText("Interactive map ready.", { exact: true })).toBeVisible();
  expect(browserCoverageRequests).toBe(0);
  await map.getByRole("checkbox", { name: "Show TX-10 boundary", exact: true }).check();
  await expect(map).toContainText("Official TX-10 boundary shown.");
  await expect(map.getByRole("link", { name: "Boundary source", exact: true })).toHaveAttribute("href", coverage.properties.sourceUrl);
  await map.getByRole("button", { name: "Zoom to coverage", exact: true }).click();
  expect(browserCoverageRequests).toBe(1);
  const renderer = map.getByRole("region", { name: "Interactive journey map", exact: true });
  await expect(renderer).toHaveAttribute("data-origin-latitude", "30.6501234");
  await expect(renderer).toHaveAttribute("data-origin-longitude", "-96.3505678");
  await page.screenshot({ path: testInfo.outputPath("tx10-official-boundary-fixture-map.png"), fullPage: true });
  await map.getByRole("checkbox", { name: "Show TX-10 boundary", exact: true }).uncheck();
  await expect(map.getByText("Official TX-10 boundary shown.", { exact: false })).toHaveCount(0);
  await expect(renderer).toHaveAttribute("data-origin-latitude", "30.6501234");
});
