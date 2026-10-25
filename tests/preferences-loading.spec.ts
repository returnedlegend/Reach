import { test, expect } from "@playwright/test";
test("preference interpretation cancels stale text and prevents concurrent calls", async ({
  page,
}) => {
  let release!: () => void;
  let calls = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/access/assist", async (route) => {
    calls++;
    if (calls === 1) await pending;
    await route
      .fulfill({
        json: {
          status: "available",
          patch: { maxWalkingMinutes: 5 },
          message: calls === 1 ? "Old interpretation" : "New interpretation",
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Step-by-step trip controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .first()
    .click();
  const input = page.getByLabel("Describe what matters to your trip");
  await input.fill("I can walk for ten minutes");
  await page
    .getByRole("button", { name: "Interpret preferences", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Analyzing…", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(1);
  await input.fill("I can walk for five minutes");
  await expect(
    page.getByRole("button", { name: "Interpret preferences", exact: true }),
  ).toBeEnabled();
  release();
  await expect(
    page.getByText("Old interpretation", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Interpret preferences", exact: true })
    .click();
  await expect(
    page.getByText("New interpretation", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(2);
});
