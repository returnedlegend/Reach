import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("key screens have no detected WCAG A/AA violations", async ({ page }) => {
  const check = async () => {
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  };
  await page.goto("/pantry-planner");
  await check();
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect(page.locator(".option-card")).toHaveCount(6);
  await check();
  await page
    .locator(".option-card.fits")
    .first()
    .getByRole("button", { name: "View trip details" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await check();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Our information", exact: true })
    .click();
  await check();
});
