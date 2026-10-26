import { expect, test } from "@playwright/test";
import { evaluateAccess } from "../src/lib/access-engine";
import { recommendPantry } from "../src/lib/pantry-recommendation";
import {
  accessInput,
  FIXED_NOW,
  journeyLookup,
  syntheticCandidate,
  syntheticJourney,
} from "./fixtures/access-scenarios";
async function example() {
  const input = accessInput();
  const result = await evaluateAccess(
    input,
    [
      syntheticCandidate("near-unverified", {
        verificationStatus: "needs-confirmation",
        name: "Synthetic unverified site",
      }),
      syntheticCandidate("checked", {
        coordinates: { lat: 30, lng: -96.02 },
        name: "Synthetic checked pantry",
      }),
    ],
    journeyLookup({
      "-96.0100": [syntheticJourney({ arrival: 490 })],
      "-96.0200": [syntheticJourney()],
    }),
    FIXED_NOW,
  );
  result.recommendation = recommendPantry(result, input, {
    siteLimit: 8,
    routeLimitReached: false,
  });
  return result;
}
async function search(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trip planner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .click();
  const planner = page.locator(".access-planner");
  const picker = planner.locator(".location-picker").first();
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await planner
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .click();
  return planner;
}
test("recommendation panel selects the verified timed trip and explains comparison limits", async ({
  page,
}) => {
  const result = await example();
  await page.route("**/api/access/plan", (r) => r.fulfill({ json: result }));
  const planner = await search(page);
  const panel = planner.getByRole("region", {
    name: "Pantry recommendation",
    exact: true,
  });
  await expect(panel).toContainText(
    "Best checked pantry: Synthetic checked pantry",
  );
  await expect(panel).toContainText(
    "sites without verified locations excluded",
  );
  await panel.getByText("Why this recommendation?", { exact: true }).click();
  await expect(panel).toContainText(
    "Scores are planning points, not success probabilities",
  );
  await panel
    .getByRole("button", { name: "View recommended pantry", exact: true })
    .click();
  await expect(
    planner.locator(".access-planner__card.is-selected"),
  ).toContainText("Synthetic checked pantry");
});
test("an unavailable recommendation never promotes a browse-only unverified site", async ({
  page,
}) => {
  const result = await example();
  result.options = result.options.filter((o) => o.id === "near-unverified");
  result.recommendation = recommendPantry(result, accessInput(), {
    siteLimit: 8,
    routeLimitReached: false,
  });
  await page.route("**/api/access/plan", (r) => r.fulfill({ json: result }));
  const planner = await search(page);
  const panel = planner.getByRole("region", {
    name: "Pantry recommendation",
    exact: true,
  });
  await expect(panel).toContainText("No pantry recommendation is confirmed");
  await expect(
    panel.getByRole("button", { name: "View recommended pantry" }),
  ).toHaveCount(0);
});
