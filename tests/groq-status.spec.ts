import { test, expect } from "@playwright/test";

test("missing Groq credentials leave results available with an actionable explanation", async ({ page }) => {
  await page.route("**/api/food-search", route => route.fulfill({ json: {
    assistance: "directory", intent: { service: "food" },
    aiMessage: "AI needs a GROQ_API_KEY on the Reach server. Pantry matches remain available.",
  } }));
  await page.goto("/");
  await page.getByLabel("What do you need?", { exact: true }).fill("food in Bryan");
  await page.getByRole("button", { name: "Find best resources", exact: true }).click();
  await expect(page.getByText(/AI needs a GROQ_API_KEY/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Places to try", exact: true }).getByRole("article")).toHaveCount(3);
});
