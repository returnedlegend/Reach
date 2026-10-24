import { expect, test } from "@playwright/test";
import { renderEmail } from "../src/lib/email-templates";

for (const kind of ["verification", "notification"] as const) {
  test(`${kind} email stays readable and usable from mobile to desktop`, async ({
    page,
  }) => {
    const previous = process.env.REACH_APP_ORIGIN;
    process.env.REACH_APP_ORIGIN = "https://reach.example";
    let html: string;
    try {
      html = renderEmail({
        heading:
          kind === "verification"
            ? "Verify your Reach email"
            : "A food pickup opportunity is available",
        paragraphs: [
          "Sign in to Reach to review the current details and choose your next step.",
        ],
        action: {
          label: kind === "verification" ? "Verify email" : "Review in Reach",
          url:
            kind === "verification"
              ? `https://reach.example/account#verify=${"a".repeat(64)}`
              : "https://reach.example/volunteer",
        },
        ...(kind === "notification"
          ? {
              unsubscribeUrl: `https://reach.example/unsubscribe#token=${"b".repeat(64)}`,
            }
          : {}),
      }).html;
    } finally {
      if (previous === undefined) delete process.env.REACH_APP_ORIGIN;
      else process.env.REACH_APP_ORIGIN = previous;
    }
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html);
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
      const cta = page.getByRole("link", {
        name: kind === "verification" ? "Verify email" : "Review in Reach",
        exact: true,
      });
      await expect(cta).toBeVisible();
      const bounds = await cta.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.locator("script,img,iframe").count()).toBe(0);
      if (kind === "notification")
        await expect(
          page.getByRole("link", { name: "Unsubscribe from these emails" }),
        ).toBeVisible();
    }
    const cta = page.getByRole("link", {
      name: kind === "verification" ? "Verify email" : "Review in Reach",
      exact: true,
    });
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.keyboard.press("Tab");
    await expect(cta).toBeFocused();
  });
}
