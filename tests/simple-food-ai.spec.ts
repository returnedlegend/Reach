import { expect, test } from "@playwright/test";

test.skip(
  process.env.REACH_TEST_AI_CONFIGURED !== "true",
  "Requires a local AI-configured extended preview. Provider requests are intercepted, not live inference.",
);
test("AI interpretation never blocks directory results or receives selected coordinates", async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/food-search", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        assistance: "ai",
        intent: { service: "food", mode: "transit" },
      }),
    });
  });
  await page.goto("/");
  await page
    .getByRole("checkbox", { name: /Use AI to help understand/ })
    .check();
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
  const link = page
    .getByRole("link", { name: "Google Maps directions" })
    .first();
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.get("travelmode"),
  ).toBe("transit");
});
test("failed AI keeps food results and discloses attempted interpretation", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic unavailable provider" }),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("checkbox", { name: /Use AI to help understand/ })
    .check();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("I need food in Bryan");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await expect(
    page.getByText(/The AI service could not be reached/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
});
test("turning AI off prevents a late interpretation from replacing results", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/food-search", async (route) => {
    await pending;
    await route
      .fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          assistance: "ai",
          intent: { service: "shelter" },
        }),
      })
      .catch(() => {});
  });
  await page.goto("/");
  const choice = page.getByRole("checkbox", {
    name: /Use AI to help understand/,
  });
  await choice.check();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("I need food in Bryan");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await expect(page.getByText(/Checking your request with AI/)).toBeVisible();
  await choice.uncheck();
  release();
  await expect(
    page.getByText(/AI could not finish interpreting/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
  await expect(
    page.getByText(/Reach does not have verified shelter availability/),
  ).toHaveCount(0);
});

test("a manual travel choice wins over an earlier pending AI interpretation", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/food-search/plan", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        options: [],
        recommendation: { selectedId: null },
        message: "Synthetic unavailable trip",
      }),
    }),
  );
  await page.route("**/api/food-search", async (route) => {
    await pending;
    await route
      .fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          assistance: "ai",
          intent: { service: "food", mode: "walking" },
        }),
      })
      .catch(() => {});
  });
  await page.goto("/");
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.65");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.35");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /Use AI to help understand/ })
    .check();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("I need food in Bryan");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await expect(page.getByText(/Checking your request with AI/)).toBeVisible();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  release();
  await expect(
    page.getByRole("button", { name: "Ride", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("link", { name: "Google Maps directions" }).first(),
  ).toHaveAttribute("href", /travelmode=driving/);
  await expect(page.getByText(/AI helped understand your request/)).toHaveCount(
    0,
  );
});
