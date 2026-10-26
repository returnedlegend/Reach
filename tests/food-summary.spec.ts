import { test, expect } from "@playwright/test";
test("shows generated option summary and clears it when AI is disabled", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      json: {
        assistance: "ai",
        intent: { service: "food" },
        rankedAt: new Date().toISOString(),
        ranking: [
          {
            id: "bridge-ministries",
            reasons: ["Confirm requirements."],
            selectedBy: "ai",
          },
        ],
        summary: [
          {
            id: "bridge-ministries",
            name: "The Bridge Ministries Bryan",
            text: "This option lists groceries; confirm appointment requirements before traveling.",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  const summary = page.getByRole("region", { name: "AI’s quick take" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText(/This option lists groceries/)).toBeVisible();
  await expect(
    summary.getByText(/AI-generated from listed facts/),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Compare with AI/ })
    .uncheck();
  await expect(summary).toHaveCount(0);
});
