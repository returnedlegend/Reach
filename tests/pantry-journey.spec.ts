import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("pantry details preserve the selected origin and return keyboard focus to the journey", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
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
  const trigger = page
    .getByRole("button", {
      name: "Pantry information & busy times",
      exact: true,
    })
    .first();
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Pantry information",
    exact: true,
  });
  await expect(
    dialog.getByRole("heading", {
      name: "Transportation & directions",
      exact: true,
    }),
  ).toBeVisible();
  const handoff = dialog.getByRole("link", { name: "Open in Google Maps (transit)" });
  const url = new URL((await handoff.getAttribute("href"))!);
  expect(url.searchParams.get("origin")).toBe("30.6501234,-96.3505678");
  expect(url.searchParams.get("travelmode")).toBe("transit");
  const accessibility = await new AxeBuilder({ page })
    .include(".reach-pantry-dialog")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
