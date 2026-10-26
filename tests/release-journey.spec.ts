import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function choosePantry(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trip planner", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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
  await page
    .getByLabel("Where would you like to go?", { exact: true })
    .selectOption("brazos-church-pantry");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Brazos Church Pantry", exact: true })
    .click();
}

test("the public journey saves, exports and prints a private trip snapshot", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => window.dispatchEvent(new Event("beforeprint")),
    });
  });
  await choosePantry(page);
  await expect(page.getByText(/Pedestrian pickup:/)).toBeVisible();
  await expect(page.locator("[data-source-freshness]").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Get directions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trip directions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Google Maps" }),
  ).toBeVisible();
  const handoff = new URL(
    (await page
      .getByRole("link", { name: "Open in Google Maps" })
      .getAttribute("href"))!,
  );
  expect(handoff.searchParams.get("origin")).toBe("30.6501234,-96.3505678");
  expect(handoff.searchParams.get("travelmode")).toBe("walking");
  const destinationRecord = await (
    await page.request.get("/api/pantries/brazos-church-pantry")
  ).json();
  const point = destinationRecord.pantry.coordinates;
  expect(handoff.searchParams.get("destination")).toBe(
    `${point.lat},${point.lng}`,
  );

  await page.getByText("Save these directions", { exact: true }).click();
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(page.locator(".reach-notice")).toContainText(
    "Your starting point was not saved",
  );
  const raw = await page.evaluate(() =>
    window.localStorage.getItem("reach.saved-items.v1"),
  );
  expect(raw).toBeTruthy();
  const saved = JSON.parse(raw!);
  expect(saved.trips[0].origin).toBeUndefined();
  expect(raw).not.toContain("30.6501234");

  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByText("View saved trip", { exact: true }).click();
  const snapshot = page.locator(".reach-trip-text");
  await expect(snapshot).toContainText("Created:");
  await expect(snapshot).toContainText("Visit requirements:");
  await expect(snapshot).toContainText("Sources and checked dates:");
  await expect(snapshot).toContainText("may be out of date");
  await expect(snapshot).not.toContainText("30.6501234");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download text", exact: true })
    .click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const exported = await readFile(filePath!, "utf8");
  expect(exported).toContain("Visit requirements:");
  expect(exported).toContain("may be out of date");
  expect(exported).not.toContain("30.6501234");

  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.locator(".reach-print-content")).toContainText("Created:");
});

test("denied location and blocked storage keep manual discovery usable", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions([], { origin: baseURL! });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is blocked", "SecurityError");
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trip planner", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByRole("button", { name: "Use my location" }).click();
  await expect(picker).toContainText("Location permission was denied");
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Where would you like to go?", { exact: true })
    .selectOption("brazos-church-pantry");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Brazos Church Pantry", exact: true })
    .click();
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(page.locator(".reach-notice")).toContainText(
    "This browser could not save your items",
  );
  await expect(
    page.getByRole("button", { name: "Explore", exact: true }),
  ).toBeVisible();
});

test("@core-release hides every gated public entry point", async ({ page }) => {
  test.skip(
    !process.env.REACH_TEST_URL,
    "This check runs against the production CORE release URL.",
  );
  await page.goto("/");
  for (const label of [
    /account/i,
    /community/i,
    /food hotspots/i,
    /volunteer/i,
    /reach ai assistant/i,
  ]) {
    await expect(
      page
        .getByRole("link", { name: label })
        .or(page.getByRole("button", { name: label })),
    ).toHaveCount(0);
  }
});
