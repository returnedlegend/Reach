import { expect, test, type Page } from "@playwright/test";

// These browser checks use the real map component with a neutral background
// style and synthetic route responses. They do not establish live route times.
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "qa-background",
                type: "background",
                paint: { "background-color": "#e9eee8" },
              },
            ],
          },
        })
      : route.abort("blockedbyclient"),
  );
});

async function mapDirectory(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const directory = page.getByRole("region", { name: "Map resource list" });
  await directory.getByText("Filter resources", { exact: true }).click();
  return directory;
}

async function chooseManualOrigin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Choose starting point" }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const directory = page.getByRole("region", { name: "Map resource list" });
  await directory.getByText("Filter resources", { exact: true }).click();
  return directory;
}

test("Map directory searches ZIP and city fields and explains coverage limits", async ({
  page,
}) => {
  const directory = await mapDirectory(page);
  const search = directory.getByLabel("Search places, city or ZIP", {
    exact: true,
  });
  await search.fill("78602");
  await expect(directory.getByRole("article")).toHaveCount(1);
  await expect(
    directory.getByRole("article", {
      name: "Bastrop County Emergency Food Pantry",
      exact: true,
    }),
  ).toBeVisible();

  await search.fill("Bastrop");
  await expect(directory.getByRole("article")).toHaveCount(1);
  await expect(
    directory.getByRole("article", {
      name: "Bastrop County Emergency Food Pantry",
      exact: true,
    }),
  ).toBeVisible();

  await search.fill("Neverland 99999");
  await expect(
    directory.getByRole("heading", {
      name: "No listings match these filters",
      exact: true,
    }),
  ).toBeVisible();
  await expect(directory).toContainText(
    "selected sites in central Texas, not every community",
  );
  await expect(directory).toContainText(
    "A search elsewhere does not establish that no food assistance exists",
  );
});

test("service filters use recorded offering facts", async ({ page }) => {
  const directory = await mapDirectory(page);
  await directory
    .getByLabel("Food assistance filter", { exact: true })
    .selectOption("produce");
  const cards = directory.getByRole("article");
  await expect(cards).toHaveCount(2);
  await expect(
    directory.getByRole("article", {
      name: "First Baptist Church of College Station",
      exact: true,
    }),
  ).toContainText(/produce/i);
  await expect(
    directory.getByRole("article", {
      name: "Bastrop County Emergency Food Pantry",
      exact: true,
    }),
  ).toContainText(/produce/i);
  for (const card of await cards.all())
    await expect(card.locator(".reach-offering")).toContainText(
      /produce|fresh food/i,
    );
});

test("travel comparison is explicit, limited to five routes, sorts routed metrics, and clears after origin changes", async ({
  page,
}) => {
  const requests: { origin: { lat: number; lng: number }; mode: string }[] = [];
  await page.route("**/api/journey", async (route) => {
    const body = route.request().postDataJSON() as {
      origin: { lat: number; lng: number };
      mode: string;
    };
    requests.push({ origin: body.origin, mode: body.mode });
    if (requests.length <= 2) {
      await route.fulfill({
        json: {
          status: "available",
          label: "Synthetic controlled route",
          message: "Synthetic fixture for browser QA only.",
          distanceMiles: requests.length === 1 ? 1.25 : 2.5,
          durationMinutes: requests.length === 1 ? 12 : 28,
          steps: [],
        },
      });
    } else {
      await route.fulfill({
        json: {
          status: "unavailable",
          reason: "network",
          message: "Synthetic unavailable fixture; route time remains unknown.",
        },
      });
    }
  });
  const directory = await chooseManualOrigin(page);
  expect(requests).toEqual([]);
  const originalOrder = await directory
    .locator(".reach-resource")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("aria-label")),
    );
  await directory
    .getByRole("button", { name: "Compare nearby travel times", exact: true })
    .click();
  await expect(directory.getByRole("status")).toContainText(
    "nearby sites have routed travel times",
  );
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(requests.length).toBeLessThanOrEqual(5);
  expect(requests.every((request) => request.mode === "walking")).toBe(true);
  expect(
    requests.every(
      (request) =>
        request.origin.lat === 30.6501234 && request.origin.lng === -96.3505678,
    ),
  ).toBe(true);
  await expect(
    directory.getByText(
      /Routed: 1\.25 miles · 12 minutes \(walking, estimated\)/,
    ),
  ).toBeVisible();
  await expect(
    directory.getByText(
      /Routed: 2\.50 miles · 28 minutes \(walking, estimated\)/,
    ),
  ).toBeVisible();
  await expect(
    directory
      .locator(".reach-resource .reach-help")
      .filter({ hasText: "Routed:" }),
  ).toHaveCount(2);
  await expect(
    directory.getByLabel("Sort options", { exact: true }),
  ).toHaveValue("travel");
  const routedOrder = await directory
    .locator(".reach-resource")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("aria-label")),
    );
  expect(routedOrder.slice(0, 2)).toEqual(originalOrder.slice(0, 2));

  const completedRequestCount = requests.length;
  await page
    .getByRole("button", { name: "Edit starting point", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6601234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3605678");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const updatedDirectory = page.getByRole("region", {
    name: "Map resource list",
  });
  await updatedDirectory.getByText("Filter resources", { exact: true }).click();
  await expect(updatedDirectory.getByRole("status")).toHaveCount(0);
  await expect(
    updatedDirectory
      .locator(".reach-resource .reach-help")
      .filter({ hasText: "Routed:" }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(completedRequestCount);
});
