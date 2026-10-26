import { expect, test } from "@playwright/test";

async function openAssistant(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trip planner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reach AI assistant", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Reach AI assistant" });
}

async function fixtureReply(
  route: import("@playwright/test").Route,
  assistance: "ai" | "computed",
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store" },
    body: JSON.stringify({
      status: "needs-location",
      assistance,
      reply: `Synthetic ${assistance} assistant fixture only.`,
    }),
  });
}

test.describe("assistant AI availability notice", () => {
  test("explains missing credentials without disabling the computed assistant", async ({
    page,
  }, info) => {
    await page.route("**/api/ai/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "private, no-store" },
        body: JSON.stringify({
          state: "unavailable",
          code: "credentials",
          message: "Synthetic status fixture: credentials are missing.",
          model: "synthetic-secret-model",
        }),
      }),
    );
    await page.route("**/api/assistant", (route) =>
      fixtureReply(route, "computed"),
    );

    const dialog = await openAssistant(page);
    const status = dialog.locator(".reach-assistant__ai-status");
    await expect(status).toContainText(
      "AI is not connected on this Reach server yet",
    );
    await expect(status).not.toContainText(
      /credentials|secret-model|synthetic-secret/i,
    );
    const send = dialog.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await dialog
      .getByLabel("What do you need help finding?")
      .fill("Synthetic groceries request");
    await expect(send).toBeEnabled();
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath(`ai-${info.project.name}-notice.png`),
      fullPage: true,
    });
    await send.click();
    await expect(
      dialog.getByText("Computed from published information"),
    ).toBeVisible();
    await expect(
      dialog.getByText("Synthetic computed assistant fixture only."),
    ).toBeVisible();
  });

  test("shows a safe fallback when the status request fails and still accepts a request", async ({
    page,
  }) => {
    await page.route("**/api/ai/status", (route) => route.abort("failed"));
    await page.route("**/api/assistant", (route) =>
      fixtureReply(route, "computed"),
    );

    const dialog = await openAssistant(page);
    const status = dialog.locator(".reach-assistant__ai-status");
    await expect(status).toContainText("AI availability could not be checked");
    await expect(
      dialog.getByRole("button", { name: "Send", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel("What do you need help finding?")
      .fill("Synthetic fallback request");
    await expect(
      dialog.getByRole("button", { name: "Send", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      dialog.getByText("Computed from published information"),
    ).toBeVisible();
  });

  test("labels configured AI without exposing model configuration", async ({
    page,
  }) => {
    await page.route("**/api/ai/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "private, no-store" },
        body: JSON.stringify({
          state: "configured",
          code: null,
          message: "Synthetic configured fixture only.",
          model: "deepseek-flash",
        }),
      }),
    );
    await page.route("**/api/assistant", (route) => fixtureReply(route, "ai"));

    const dialog = await openAssistant(page);
    const status = dialog.locator(".reach-assistant__ai-status");
    await expect(status).toContainText("AI interpretation is configured");
    await expect(status).not.toContainText(/deepseek|free|synthetic/i);
    await dialog
      .getByLabel("What do you need help finding?")
      .fill("Synthetic AI request");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByText("AI-assisted summary")).toBeVisible();
    await expect(
      dialog.getByText("Synthetic ai assistant fixture only."),
    ).toBeVisible();
  });
});
