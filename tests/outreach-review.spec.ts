import { expect, test } from "@playwright/test";
import type {
  OutreachMessage,
  OutreachRecipient,
} from "../src/lib/outreach-types";

// Synthetic API fixtures exercise review behavior without sending any email.
test("outreach requires renewed approval after edits or follow-up changes", async ({
  page,
}) => {
  const recipient: OutreachRecipient = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic test pantry",
    addressLabel: "test@example.org",
    kind: "organization",
    pantryId: "synthetic-test-pantry",
    offerId: null,
    sourceUrl: "https://example.org/test",
    enrolledAt: "2026-01-01T00:00:00.000Z",
  };
  const message: OutreachMessage = {
    id: "00000000-0000-4000-8000-000000000002",
    recipient,
    subject: "Question about pickup hours",
    body: "Reach is sending an AI-assisted inquiry on a user's behalf. Could you confirm pickup hours?",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    sentAt: null,
    reply: null,
    followup: null,
  };
  const authorizations: Record<string, unknown>[] = [];
  await page.route("**/api/community/mine", (route) =>
    route.fulfill({ json: { offers: [] } }),
  );
  await page.route("**/api/outreach{,/**}", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/draft"))
      return route.fulfill({
        status: 201,
        json: { message, assistance: "template" },
      });
    if (path.endsWith("/authorize")) {
      authorizations.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        json: { message: { ...message, status: "queued" } },
      });
    }
    return route.fulfill({
      json: {
        messages: [],
        recipients: [recipient],
        deliveryMode: "preview",
        replyMailboxConfigured: false,
      },
    });
  });

  await page.goto("/outreach");
  await page
    .getByLabel("Trusted recipient", { exact: true })
    .selectOption(recipient.id);
  await page
    .getByLabel("What would you like to ask?")
    .fill("Could you confirm pickup hours?");
  await page.getByRole("button", { name: "Create a draft" }).click();
  const approve = page.getByLabel(
    "I reviewed the recipient and message and authorize this email.",
  );
  const queue = page.getByRole("button", { name: "Authorize and queue" });
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toHaveAttribute("maxlength", "4000");
  await expect(queue).toBeDisabled();
  expect(authorizations).toHaveLength(0);

  await approve.check();
  await expect(queue).toBeEnabled();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Updated pickup question");
  await expect(approve).not.toBeChecked();
  await expect(queue).toBeDisabled();

  await approve.check();
  await body.fill(message.body + " Thank you.");
  await expect(approve).not.toBeChecked();
  await expect(queue).toBeDisabled();

  await approve.check();
  await page
    .getByLabel("Allow one follow-up after 24 hours if there is no reply.", {
      exact: false,
    })
    .check();
  await expect(approve).not.toBeChecked();
  await expect(queue).toBeDisabled();
  expect(authorizations).toHaveLength(0);

  await approve.check();
  await queue.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your authorization was recorded" }),
  ).toBeVisible();
  expect(authorizations).toHaveLength(1);
  expect(authorizations[0]).toMatchObject({
    subject: "Updated pickup question",
    body: message.body + " Thank you.",
    authorized: true,
    followup: { optIn: true, intervalHours: 24, expiresInHours: 48, max: 1 },
  });
});
