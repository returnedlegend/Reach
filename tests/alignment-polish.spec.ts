import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

async function boxFor(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, width: rect.width, center: rect.x + rect.width / 2 };
  });
}

async function centered(
  page: import("@playwright/test").Page,
  selectors: string[],
) {
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  // The stable scrollbar gutter is outside the available body content width.
  const center = await page.locator("body").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.x + box.width / 2;
  });
  for (const selector of selectors) {
    const box = await boxFor(page, selector);
    expect(
      Math.abs(box.center - center),
      selector + " center",
    ).toBeLessThanOrEqual(1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
}

test("guided panels share a centered rail and tablet search fills its column", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Food and support",
  );
  const selectors = [
    ".reach-progress",
    ".reach-flow",
    ".reach-community-invite",
    ".reach-footer",
  ];
  await centered(page, selectors);
  const form = await boxFor(page, ".reach-flow");
  for (const selector of selectors)
    expect((await boxFor(page, selector)).width).toBeCloseTo(form.width, 0);
  if (page.viewportSize()!.width < 960) {
    expect((await boxFor(page, ".location-picker")).width).toBeCloseTo(
      (await boxFor(page, ".reach-intro")).width,
      0,
    );
  }
  await page.screenshot({
    path: resolve(
      "docs/evidence/alignment-" + info.project.name + "-after.png",
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where are you starting?", exact: true }),
  ).toBeVisible();
  await centered(page, [".reach-intro", ".reach-progress", ".reach-flow"]);
});

test("saved empty state centers its icon and supports dark-theme keyboard navigation", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  const trigger = page.getByRole("button", { name: "Saved", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Your saved places & trips.",
      exact: true,
    }),
  ).toBeVisible();
  await centered(page, [".reach-saved", ".reach-empty", ".reach-empty > svg"]);
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    report.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: resolve(
      "docs/evidence/alignment-" + info.project.name + "-saved-dark.png",
    ),
    fullPage: true,
  });
});
