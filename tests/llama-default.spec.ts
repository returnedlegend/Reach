import { test, expect } from "@playwright/test";
test("food search uses AI by default without an extra checkbox step", async ({
  page,
}) => {
  let payload: unknown;
  await page.route("**/api/food-search", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      json: { assistance: "ai", intent: { service: "food", mode: "transit" } },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("checkbox", { name: /Use AI to help understand/ }),
  ).toBeChecked();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("I need food in Bryan");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await expect(
    page.getByText(/AI helped understand your request/),
  ).toBeVisible();
  expect(payload).toEqual({ message: "I need food in Bryan", useAI: true });
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
});
test("an unavailable model leaves real pantry results usable", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic stopped model server" },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await expect(
    page.getByText(/your text may have reached the AI provider/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
});
