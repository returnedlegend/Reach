import { expect, test } from "@playwright/test";

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

test("district zoom clusters overlapping resource pins into one keyboard accessible chooser", async ({
  page,
}) => {
  await page.goto("/");
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
    .selectOption("a-hopeful-harvest");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();

  const journeyMap = page.getByRole("region", {
    name: "Journey map",
    exact: true,
  });
  await journeyMap.getByRole("button", { name: "Zoom to coverage" }).click();
  await expect(journeyMap).toContainText("Official TX-10 boundary shown.");
  const map = journeyMap.getByRole("region", {
    name: "Interactive journey map",
  });
  const clusteredPins = map.locator('button[data-clustered="true"]');
  await expect(clusteredPins.first()).toBeVisible();
  const cluster = clusteredPins.first();
  await expect(cluster.locator("[data-overlap-badge]")).toHaveCount(1);
  const clusterSize = Number(await cluster.getAttribute("data-overlap-count"));
  expect(clusterSize).toBeGreaterThan(1);

  await cluster.focus();
  await page.keyboard.press("Enter");
  const chooser = map.getByRole("dialog", { name: "Choose a map resource" });
  await expect(chooser).toBeVisible();
  await expect(
    chooser.getByRole("button", { name: "Close map resource chooser" }),
  ).toBeVisible();
  expect(await chooser.getByRole("button").count()).toBe(clusterSize + 1);
});
