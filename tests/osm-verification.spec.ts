import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// MapLibre itself and its WebGL/DOM rendering stay real. Routine runs replace
// the provider style and tiles, so they never bulk-fetch public map services.
// Fixtures cannot establish provider uptime, real cartography, or route accuracy.
const rasterFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACwElEQVR4nO3TMQ0AMAzAsPJnuWfPSAxGj1gygDyZ8y5kzXoBLDIAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANI+xuYob7j3/CUAAAAASUVORK5CYII=",
  "base64",
);

const fixtureStyle = {
  version: 8,
  sources: {
    controlled: {
      type: "raster",
      tiles: ["https://tiles.reach-test.invalid/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a>',
    },
  },
  layers: [{ id: "controlled-map", type: "raster", source: "controlled" }],
};

test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.reach-test.invalid/**", (route) =>
    route.fulfill({ contentType: "image/png", body: rasterFixture }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({ json: fixtureStyle })
      : route.abort("blockedbyclient"),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: rasterFixture }),
  );
});

async function startingLocation(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Trip planner",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /^Food\b/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
}

async function pantryDirectory(
  page: Page,
): Promise<{ coordinates: unknown }[]> {
  const response = await page.request.get("/api/pantries?pageSize=100");
  expect(response.ok()).toBe(true);
  return (await response.json()).pantries;
}

async function foodOptions(page: Page) {
  await startingLocation(page);
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Where would you like to go?")
    .selectOption("bridge-ministries");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
}

test("address lookup waits for explicit submit and supports keyboard result selection", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/api/geocode", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        status: "available",
        candidates: [
          {
            label: "Controlled address match",
            coordinates: { lat: 30.65, lng: -96.35 },
          },
        ],
      },
    });
  });
  await startingLocation(page);
  const address = page.getByLabel("Address", { exact: true });
  await address.pressSequentially("304 W 26th Street, Bryan", { delay: 15 });
  await page.getByLabel("Latitude", { exact: true }).focus();
  expect(requests).toHaveLength(0);
  await address.focus();
  await address.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ address: "304 W 26th Street, Bryan" });
  const match = page.getByRole("button", {
    name: "Controlled address match",
    exact: true,
  });
  await match.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.65",
  );
  await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.35",
  );
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
});

test("geocoder failure preserves manual coordinate entry and keyboard continuation", async ({
  page,
}) => {
  await page.route("**/api/geocode", (route) =>
    route.fulfill({
      status: 503,
      json: {
        status: "unavailable",
        message:
          "Controlled address service outage. Enter coordinates manually.",
      },
    }),
  );
  await startingLocation(page);
  await page.getByLabel("Address", { exact: true }).fill("Bryan, Texas");
  await page
    .getByRole("button", { name: "Search address", exact: true })
    .click();
  await expect(
    page.getByText(
      "Controlled address service outage. Enter coordinates manually.",
    ),
  ).toBeVisible();
  await page.getByLabel("Latitude", { exact: true }).fill("30.65");
  await page.getByLabel("Longitude", { exact: true }).fill("-96.35");
  await page.getByRole("button", { name: "Use these coordinates" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Continue", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Travel choices", exact: true }),
  ).toBeVisible();
});

test("API rejects invalid coordinates and transit never returns invented route geometry", async ({
  request,
}) => {
  const invalid = await request.post("/api/journey", {
    data: {
      origin: { lat: 91, lng: -96.35 },
      destination: { lat: 30.64, lng: -96.36 },
      mode: "walking",
    },
  });
  expect(invalid.status()).toBe(400);
  const transit = await request.post("/api/journey", {
    data: {
      origin: { lat: 30.65, lng: -96.35 },
      destination: { lat: 30.64, lng: -96.36 },
      mode: "transit",
    },
  });
  const body = await transit.json();
  expect(body.status).toBe("unavailable");
  expect(body.geometry).toBeUndefined();
  expect(body.polyline).toBeUndefined();
  expect(body.distanceMiles).toBeUndefined();
  expect(body.durationMinutes).toBeUndefined();
});

test("tile outage leaves all pantry cards and coordinate correction usable without Google SDK traffic", async ({
  page,
}) => {
  const googleRequests: string[] = [];
  page.on("request", (request) => {
    if (/https:\/\/[^/]*(googleapis|gstatic)\.com\//.test(request.url()))
      googleRequests.push(request.url());
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort("internetdisconnected"),
  );
  await foodOptions(page);
  const options = page.getByRole("region", { name: "Food assistance options" });
  await expect(options.getByRole("article")).toHaveCount(
    (await pantryDirectory(page)).length,
  );
  await options
    .getByRole("button", { name: "Parkway Baptist", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("list", { name: "Map pantry alternatives", exact: true })
      .getByRole("button", { pressed: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Destination preview", exact: true }),
  ).toContainText("Parkway Baptist");
  await page
    .getByRole("button", { name: "Close destination preview", exact: true })
    .click();
  await expect(page.locator(".reach-resource-detail")).toContainText(
    "Parkway Baptist",
  );
  await page.getByRole("button", { name: "Edit starting point" }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  await expect(page.getByLabel("Latitude", { exact: true })).toBeEnabled();
  expect(googleRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("real MapLibre renders fixture tiles, keeps its canvas, and selects pantry pins by keyboard", async ({
  page,
}, testInfo) => {
  const googleRequests: string[] = [];
  let styleRequests = 0;
  page.on("request", (request) => {
    if (/https:\/\/[^/]*(googleapis|gstatic)\.com\//.test(request.url()))
      googleRequests.push(request.url());
    if (request.url().includes("tiles.openfreemap.org/styles/"))
      styleRequests++;
  });
  await foodOptions(page);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await expect(map.locator(".maplibregl-canvas")).toBeVisible();
  const selectedPin = map.getByRole("button", {
    name: /— selected pantry$/,
  });
  await expect(selectedPin).toBeVisible();
  expect(
    await selectedPin.evaluate((element) => {
      const map = element.closest('[aria-label="Interactive journey map"]');
      if (!map) return false;
      const marker = element.getBoundingClientRect();
      const bounds = map.getBoundingClientRect();
      const centerX = marker.left + marker.width / 2;
      const centerY = marker.top + marker.height / 2;
      return (
        centerX >= bounds.left &&
        centerX <= bounds.right &&
        centerY >= bounds.top &&
        centerY <= bounds.bottom
      );
    }),
  ).toBe(true);
  const canvas = await map.locator("canvas").elementHandle();
  const stylesBeforeSelection = styleRequests;
  const originBefore = (await map.locator("p").first().innerText()).split(
    "Destination:",
  )[0];
  const pin = map.getByRole("button", {
    name: "Parkway Baptist — select pantry",
    exact: true,
  });
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(
    map.getByRole("button", {
      name: "Parkway Baptist — selected pantry",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "Destination preview", exact: true }),
  ).toContainText("Parkway Baptist");
  await page
    .getByRole("button", { name: "Close destination preview", exact: true })
    .click();
  await expect(page.locator(".reach-resource-detail")).toContainText(
    "Parkway Baptist",
  );
  expect(
    (await map.locator("p").first().innerText()).split("Destination:")[0],
  ).toBe(originBefore);
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  expect(styleRequests).toBe(stylesBeforeSelection);
  await expect(
    map.getByRole("link", { name: /OpenStreetMap contributors/ }).last(),
  ).toBeVisible();
  await expect(
    map.getByRole("link", { name: "OpenMapTiles", exact: true }).last(),
  ).toBeVisible();
  expect(googleRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const report = await new AxeBuilder({ page })
    .include('[aria-label="Journey map"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    report.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("osm-fixture-map.png"),
    fullPage: true,
  });
});

test("real MapLibre origin drag changes coordinates only after confirmation", async ({
  page,
}) => {
  await startingLocation(page);
  await page.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await page.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await page.getByRole("button", { name: "Use these coordinates" }).click();
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Choose on map", exact: true })
    .click();
  const origin = map.getByRole("button", {
    name: "Trip origin — drag to correct your starting point",
    exact: true,
  });
  await expect(origin).toBeVisible();
  await map.locator("canvas").scrollIntoViewIfNeeded();
  const box = (await origin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 40,
    box.y + box.height / 2 - 30,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  await page
    .getByRole("button", { name: "Confirm location", exact: true })
    .click();
  await expect(page.getByLabel("Latitude", { exact: true })).not.toHaveValue(
    "30.6501234",
  );
  await expect(page.getByLabel("Longitude", { exact: true })).not.toHaveValue(
    "-96.3505678",
  );
  expect(
    Number(await page.getByLabel("Latitude", { exact: true }).inputValue()),
  ).toBeGreaterThan(30);
  expect(
    Number(await page.getByLabel("Longitude", { exact: true }).inputValue()),
  ).toBeLessThan(-96);
});

test("route-provider outage never invents a route line and leaves external directions usable", async ({
  page,
}) => {
  await page.route("**/api/journey", (route) =>
    route.fulfill({
      status: 503,
      json: {
        status: "unavailable",
        reason: "network",
        message: "Controlled routing outage. No route is available.",
      },
    }),
  );
  await foodOptions(page);
  await page
    .getByRole("button", { name: "Get directions", exact: true })
    .click();
  await expect(
    page.getByText("Controlled routing outage. No route is available.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Journey map", exact: true }),
  ).toContainText("No route line is provided.");
  await expect(
    page.getByRole("list", { name: "Map route legend" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in Google Maps", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/www.google.com\/maps\/dir\//);
});

test("map provider failure is announced and retry restores real rendering", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    unavailable
      ? route.abort("internetdisconnected")
      : route.fulfill({ json: fixtureStyle }),
  );
  await foodOptions(page);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(map.getByRole("status")).toContainText(
    "The interactive map is unavailable",
  );
  await expect(
    map
      .getByRole("list", { name: "Map pantry alternatives" })
      .getByRole("button"),
  ).toHaveCount(
    (await pantryDirectory(page)).filter((resource) => resource.coordinates)
      .length,
  );
  unavailable = false;
  await map.getByRole("button", { name: "Retry map", exact: true }).click();
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await expect(map.locator(".maplibregl-canvas")).toBeVisible();
});

test("reverse lookup is explicit and preserves the chosen coordinates", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/api/reverse-geocode", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        status: "available",
        candidates: [
          {
            label: "Controlled nearby road",
            coordinates: { lat: 30.67, lng: -96.37 },
          },
        ],
        attribution: [
          {
            label: "© OpenStreetMap contributors",
            url: "https://www.openstreetmap.org/copyright",
          },
        ],
      },
    });
  });
  await startingLocation(page);
  await page.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await page.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await page
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  expect(requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "Look up selected coordinates", exact: true })
    .click();
  await expect(
    page.getByText(/Selected: Controlled nearby road/),
  ).toBeVisible();
  expect(requests).toEqual([
    { coordinates: { lat: 30.6501234, lng: -96.3505678 } },
  ]);
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
});

test("provider geometry renders a walking legend and clears after a failed recomputation", async ({
  page,
}) => {
  await page.route("**/api/journey", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json:
        body.mode === "walking"
          ? {
              status: "available",
              label: "Controlled pedestrian route",
              distanceMiles: 0.8,
              durationMinutes: 17,
              steps: [{ instruction: "Controlled walking instruction" }],
              paths: [
                {
                  id: "controlled-walk",
                  mode: "walking",
                  coordinates: [
                    [-96.3505678, 30.6501234],
                    [-96.355, 30.648],
                    [-96.3606034, 30.6472913],
                  ],
                  label: "Controlled walking path",
                },
              ],
              attribution: [
                {
                  label: "© OpenStreetMap contributors",
                  url: "https://www.openstreetmap.org/copyright",
                },
              ],
            }
          : {
              status: "unavailable",
              reason: "no-route",
              message: "Controlled second route unavailable.",
            },
    });
  });
  await foodOptions(page);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Get directions", exact: true })
    .click();
  await expect(
    page.getByText("Controlled walking instruction", { exact: true }),
  ).toBeVisible();
  await expect(
    map.getByRole("list", { name: "Map route legend" }),
  ).toContainText("Controlled walking path — Walking · dashed line");
  await expect(map).toContainText("1 route line is provided.");
  await page.getByLabel("How will you travel?").selectOption("driving");
  await expect(
    page.getByText("Controlled second route unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(map.getByRole("list", { name: "Map route legend" })).toHaveCount(
    0,
  );
  await expect(map).toContainText("No route line is provided.");
});
