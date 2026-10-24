import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "controlled-background",
                type: "background",
                paint: { "background-color": "#e9eee8" },
              },
            ],
          },
        })
      : route.abort("blockedbyclient"),
  );
});

async function startingPoint(page: Page, need = "Food") {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${need}\\b`) }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  return page.getByRole("region", { name: "Choose a starting location" });
}

async function manualFoodOptions(page: Page, mode = "walking") {
  const picker = await startingPoint(page);
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Where would you like to go?")
    .selectOption("bridge-ministries");
  await page.getByLabel("How will you travel?").selectOption(mode);
  await page.getByRole("button", { name: "Show my options" }).click();
}

test("guided manual coordinates preserve precision in actual directions and disclose missing services", async ({
  page,
}, testInfo) => {
  let journey: Record<string, unknown> | undefined;
  await page.route("**/api/journey", async (route) => {
    journey = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        message: "Controlled review: directions are unavailable.",
      }),
    });
  });
  await manualFoodOptions(page);
  await expect(
    page.getByRole("heading", { name: "Your options", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Google Maps", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Get directions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trip directions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Map resource list", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Trip directions", exact: true })
      .getByRole("status"),
  ).toContainText("Controlled review: directions are unavailable.");
  expect(journey).toEqual({
    origin: { lat: 30.6501234, lng: -96.3505678 },
    destination: { lat: 30.6472913, lng: -96.3606034 },
    mode: "walking",
    missedBus: false,
  });
  const directions = page.getByRole("link", {
    name: "Open in Google Maps",
    exact: true,
  });
  const url = new URL((await directions.getAttribute("href"))!);
  expect(url.origin).toBe("https://www.google.com");
  expect(url.searchParams.get("origin")).toBe("30.6501234,-96.3505678");
  expect(url.searchParams.get("destination")).toBe("30.6472913,-96.3606034");
  expect(url.searchParams.get("travelmode")).toBe("walking");
  await expect(
    page.getByText(
      /Google Maps opens separately and calculates its own route\./,
    ),
  ).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Explore", exact: true }).click();
  await page
    .getByText("Official transportation alternatives", { exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Bryan ISD school transportation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("For eligible, registered students.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official Stopfinder announcement (2024)" }),
  ).toHaveAttribute("href", "https://www.bryanisd.org/article/1662114");
  await expect(page.locator("main")).not.toContainText(
    "Sample Community Pantry",
  );
  // A shared legacy flex rule previously squeezed the resource heading into
  // one-letter columns while overflow and axe still passed.
  const heading = page.locator(".reach-resource-detail").getByRole("heading", {
    name: "The Bridge Ministries Bryan",
    exact: true,
  });
  expect((await heading.boundingBox())!.width).toBeGreaterThanOrEqual(140);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("guided-food-options.png"),
    fullPage: true,
  });
});

test("geolocation is opt-in and uses fresh high accuracy coordinates with an uncertainty label", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      reachGeoCalls?: PositionOptions[];
    };
    state.reachGeoCalls = [];
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(
          success: PositionCallback,
          _error: PositionErrorCallback,
          options: PositionOptions,
        ) {
          state.reachGeoCalls!.push(options);
          success({
            timestamp: Date.now(),
            coords: {
              latitude: 30.6501234,
              longitude: -96.3505678,
              accuracy: 12,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
          } as GeolocationPosition);
        },
      },
    });
  });
  const picker = await startingPoint(page);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { reachGeoCalls: PositionOptions[] })
          .reachGeoCalls.length,
    ),
  ).toBe(0);
  await picker.getByRole("button", { name: "Use my location" }).click();
  await expect(picker).toContainText("estimated accuracy ±12 m");
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { reachGeoCalls: PositionOptions[] })
          .reachGeoCalls,
    ),
  ).toEqual([{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }]);
});

test("denied location and unavailable address search keep manual fallback usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) {
          error({
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: "Denied in test",
          });
        },
      },
    });
  });
  await page.route("**/api/geocode", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        message:
          "Address search is not configured. Enter coordinates manually.",
      }),
    }),
  );
  const picker = await startingPoint(page);
  await picker.getByRole("button", { name: "Use my location" }).click();
  await expect(picker.getByRole("status")).toContainText(
    "permission was denied",
  );
  await picker
    .getByLabel("Address", { exact: true })
    .fill("304 Post Office Street, Bryan, TX");
  await picker.getByRole("button", { name: "Search address" }).click();
  await expect(picker.getByRole("status")).toContainText("not configured");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await expect(picker.getByRole("status")).toContainText("Enter a latitude");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.65");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.35");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
});

for (const scenario of ["timeout", "unavailable", "stale"] as const) {
  test(`geolocation ${scenario} does not select an unverified origin`, async ({
    page,
  }) => {
    await page.addInitScript((caseName) => {
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition(
            success: PositionCallback,
            error: PositionErrorCallback,
          ) {
            if (caseName === "stale") {
              success({
                timestamp: Date.now() - 120_001,
                coords: {
                  latitude: 30.65,
                  longitude: -96.35,
                  accuracy: 12,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null,
                },
              } as GeolocationPosition);
            } else {
              error({
                code: caseName === "timeout" ? 3 : 2,
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3,
                message: "Browser error simulation",
              });
            }
          },
        },
      });
    }, scenario);
    const picker = await startingPoint(page);
    await picker.getByRole("button", { name: "Use my location" }).click();
    await expect(picker.getByRole("status")).toContainText(
      scenario === "timeout"
        ? "timed out"
        : scenario === "stale"
          ? "old location"
          : "location is unavailable",
    );
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeDisabled();
    await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
      "",
    );
    await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      picker.getByRole("button", { name: "Use my location" }),
    ).toBeEnabled();
  });
}

test("a pending GPS response cannot replace a later manual coordinate selection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(success: PositionCallback) {
          (
            window as typeof window & { reachPendingGps?: PositionCallback }
          ).reachPendingGps = success;
        },
      },
    });
  });
  const picker = await startingPoint(page);
  await picker.getByRole("button", { name: "Use my location" }).click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6609876");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await page.evaluate(() => {
    (window as typeof window & { reachPendingGps?: PositionCallback })
      .reachPendingGps!({
      timestamp: Date.now(),
      coords: {
        latitude: 30.65,
        longitude: -96.36,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition);
  });
  await expect(picker).toContainText(
    "Selected: Manually entered starting point",
  );
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6609876",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  // The same browser callback must also be ignored after this picker unmounts.
  await picker.getByRole("button", { name: "Use my location" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.evaluate(() => {
    (window as typeof window & { reachPendingGps?: PositionCallback })
      .reachPendingGps!({
      timestamp: Date.now(),
      coords: {
        latitude: 30.7,
        longitude: -96.4,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition);
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(picker).toContainText(
    "Selected: Manually entered starting point",
  );
});

test("editing an origin discards a pending route response", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/api/journey", async (route) => {
    const origin = route.request().postDataJSON().origin;
    if (origin.lat !== 30.6501234) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "available",
          label: "Updated route",
          distanceMiles: 2.34,
          durationMinutes: 20,
        }),
      });
      return;
    }
    requested();
    await pending;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "available",
        label: "STALE ROUTE RESPONSE",
        distanceMiles: 1.23,
        durationMinutes: 12,
        steps: [{ instruction: "STALE WALK" }],
      }),
    });
  });
  await manualFoodOptions(page);
  await page.getByRole("button", { name: "Get directions", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "Edit starting point" }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6609876");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  release();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Show my options" }).click();
  await page.getByRole("button", { name: "Get directions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trip directions" })).toBeVisible();
  const updatedDirections = new URL(
    (await page
      .getByRole("link", { name: "Open in Google Maps", exact: true })
      .getAttribute("href"))!,
  );
  expect(updatedDirections.searchParams.get("origin")).toBe(
    "30.6609876,-96.3505678",
  );
  await expect(page.locator("main")).not.toContainText("STALE ROUTE RESPONSE");
  await expect(page.locator("main")).not.toContainText("STALE WALK");
});

test("guided flow has no detected accessibility violations or narrow-screen overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const check = async () => {
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  };
  await check();
  await manualFoodOptions(page);
  await check();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    (await page
      .locator(".reach-resource-detail")
      .getByRole("heading", {
        name: "The Bridge Ministries Bryan",
        exact: true,
      })
      .boundingBox())!.width,
  ).toBeGreaterThanOrEqual(140);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("guided-320px.png"),
    fullPage: true,
  });
});

test("missed-bus action recomputes from current Chicago time and respects holiday and last departure", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-22T13:45:00Z") });
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/journey", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        message: "Google routing is not configured.",
      }),
    });
  });
  await startingPoint(page, "Transportation");
  await page
    .getByText("Start at a published BTD stop", { exact: true })
    .click();
  await page
    .locator(".reach-stop-list")
    .getByRole("button", {
      name: "BTD Bryan Terminal - Roy Kelly Parking Garage",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Where would you like to go?").selectOption("127");
  await page.getByLabel("How will you travel?").selectOption("transit");
  await page.getByRole("button", { name: "Show my options" }).click();
  await page.getByRole("button", { name: "Get directions", exact: true }).click();
  const trip = page.getByRole("region", {
    name: "Trip directions",
    exact: true,
  });
  const status = trip.getByRole("status");
  const calculatedAt = trip.getByText(/Calculated for/);
  await expect(status).toContainText("8:48 AM");
  await expect(status).toContainText("static timetable, not live arrivals");
  await expect(status).toContainText("app planning assumption");
  await page.clock.setFixedTime(new Date("2026-10-22T15:00:00Z"));
  await page.getByRole("button", { name: "I missed my bus" }).click();
  await expect(status).toContainText("10:48 AM");
  await expect(calculatedAt).toContainText("2026-10-22 10:00 America/Chicago");
  expect(bodies.at(-1)?.missedBus).toBe(true);
  expect(bodies.at(-1)?.origin).toEqual({ lat: 30.6729992, lng: -96.3718935 });
  await expect(status).not.toContainText("Google Maps routed distance");
  await page.clock.setFixedTime(new Date("2026-10-23T00:47:00Z"));
  await page.getByRole("button", { name: "I missed my bus" }).click();
  await expect(status).toContainText("No scheduled BTD journey remains today");
  await expect(calculatedAt).toContainText("2026-10-22 19:47 America/Chicago");
  await page.clock.setFixedTime(new Date("2026-11-26T14:00:00Z"));
  await page.getByRole("button", { name: "I missed my bus" }).click();
  await expect(status).toContainText("No scheduled BTD journey remains today");
  await expect(calculatedAt).toContainText("2026-11-26 08:00 America/Chicago");
});

// Independent public-boundary checks. Do not import validation helpers: a
// regression must be caught through the HTTP contract used by the browser.
const scheduledInput = {
  originId: "btd-north-terminal",
  date: "2026-10-22",
  earliestDeparture: "08:00",
  latestReturn: "14:00",
  mode: "bus",
  maxWalkMiles: 1,
  visitMinutes: 30,
  appointmentStatus: "unknown",
  arrivalBufferMinutes: 5,
};

test("production planning rejects fixture origins, invalid dates and broken time windows", async ({
  request,
}) => {
  for (const change of [
    { originId: "fictional-origin" },
    { date: "2026-02-30" },
    { earliestDeparture: "25:00" },
    { earliestDeparture: "13:00", latestReturn: "12:00" },
    { maxWalkMiles: -1 },
    { boardingBufferMinutes: -1 },
  ]) {
    const response = await request.post("/api/plan", {
      data: { demo: false, input: { ...scheduledInput, ...change } },
    });
    expect(response.status(), JSON.stringify(change)).toBe(400);
    const body = await response.json();
    expect(body.error).toEqual(expect.any(String));
    expect(body.results).toBeUndefined();
  }
});

test("planning API rejects malformed and oversized payloads without internals", async ({
  request,
}) => {
  const malformed = await request.post("/api/plan", {
    data: '{"input":',
    headers: { "Content-Type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
  const oversized = await request.post("/api/plan", {
    data: JSON.stringify({ padding: "x".repeat(20_000) }),
    headers: { "Content-Type": "application/json" },
  });
  expect(oversized.status()).toBe(413);
  for (const response of [malformed, oversized]) {
    const text = await response.text();
    expect(text).not.toMatch(
      /stack|GOOGLE_MAPS_API_KEY|node_modules|\/workspace\//i,
    );
    expect(response.headers()["content-type"]).toContain("application/json");
  }
});

const journeyRequest = {
  origin: { lat: 30.6472913, lng: -96.3606034 },
  destination: { lat: 30.6038539, lng: -96.3130975 },
  mode: "walking",
};

test("journey API validates every coordinate and refuses alternate provider destinations", async ({
  request,
}) => {
  for (const payload of [
    { ...journeyRequest, origin: { lat: 90.0001, lng: -96 } },
    { ...journeyRequest, origin: { lat: 30, lng: -180.0001 } },
    { ...journeyRequest, destination: { lat: null, lng: -96 } },
    { ...journeyRequest, destination: { lat: "30.6", lng: -96 } },
    { ...journeyRequest, destination: { lat: 30, lng: 181 } },
    {
      ...journeyRequest,
      destination: { lat: 30, lng: -96, url: "http://127.0.0.1/" },
    },
    { ...journeyRequest, url: "http://169.254.169.254/" },
    { ...journeyRequest, mode: "flying" },
    { ...journeyRequest, missedBus: "true" },
  ]) {
    const response = await request.post("/api/journey", { data: payload });
    expect(response.status(), JSON.stringify(payload)).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      status: "unavailable",
      message: expect.any(String),
      reason: "provider",
    });
    expect(body.paths).toBeUndefined();
  }
});

test("location APIs reject malformed, oversized and structurally invalid requests", async ({
  request,
}) => {
  for (const endpoint of ["/api/journey", "/api/geocode"]) {
    const malformed = await request.post(endpoint, {
      data: "{",
      headers: { "Content-Type": "application/json" },
    });
    expect(malformed.status()).toBe(400);
    const oversized = await request.post(endpoint, {
      // Multibyte input checks the byte limit rather than JS string length.
      data: JSON.stringify({ address: "é".repeat(5000) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(oversized.status()).toBe(413);
    for (const response of [malformed, oversized]) {
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(await response.text()).not.toMatch(
        /stack|GOOGLE_MAPS_API_KEY|node_modules|\/workspace\//i,
      );
    }
  }
  for (const address of ["", "x", "x".repeat(501), null, 123]) {
    expect(
      (await request.post("/api/geocode", { data: { address } })).status(),
    ).toBe(400);
  }
});

test("unconfigured OSM APIs disclose their unavailable state without invented routes", async ({
  request,
}) => {
  test.skip(
    Boolean(
      process.env.OSM_ROUTER_MODE && process.env.OSM_ROUTER_MODE !== "disabled",
    ) ||
      process.env.OSM_NOMINATIM_SINGLE_INSTANCE === "true" ||
      Boolean(process.env.OSM_GEOCODER_URL),
    "This check exercises default disabled external providers.",
  );
  for (const [endpoint, data] of [
    ["/api/journey", journeyRequest],
    ["/api/geocode", { address: "304 Post Office Street, Bryan, TX" }],
  ] as const) {
    const response = await request.post(endpoint, { data });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unavailable");
    expect(body.message).toMatch(/enable|configur|disabled/i);
    expect(body.distanceMiles).toBeUndefined();
    expect(body.durationMinutes).toBeUndefined();
    expect(body.polyline).toBeUndefined();
    expect(body.candidates).toBeUndefined();
  }
});
