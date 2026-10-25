import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("a saved Google identity does not claim login is available after configuration is removed", async ({
  page,
}) => {
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "synthetic-google-only",
          email: "fixture@gmail.com",
          emailVerified: true,
          name: "Synthetic member",
          role: "user",
        },
        preferences: {},
      },
    }),
  );
  await page.route("**/api/account/locations", (route) =>
    route.fulfill({ json: { locations: [] } }),
  );
  await page.route("**/api/pantries/favorites", (route) =>
    route.fulfill({ json: { pantries: [] } }),
  );
  await page.route("**/api/auth/google/status", (route) =>
    route.fulfill({
      json: { configured: false, linked: true, hasPassword: false },
    }),
  );
  await page.goto("/account");
  const google = page.getByRole("region", {
    name: "Google sign-in",
    exact: true,
  });
  await expect(google).toContainText(
    "Google sign-in is unavailable on this server",
  );
  await expect(google).not.toContainText("You can keep using Google");
  await expect(google).toContainText(
    "Recovery requires Reach email delivery to be configured",
  );
  await expect(
    google.getByRole("button", { name: "Disconnect Google and sign out" }),
  ).toHaveCount(0);
});

test("untrusted callback fragments cannot crash the account page or establish a session", async ({
  page,
}) => {
  await page.goto("/account#google=__proto__");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/account#google=success");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Check your current Reach account below/),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/account/me")).json()).user,
  ).toBeNull();
});

test("missing Google configuration preserves Reach password sign-in", async ({
  page,
}, info) => {
  const starts: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/google/start")
      starts.push(request.url());
  });
  await page.route("**/api/auth/google/status", (route) =>
    route.fulfill({
      json: { configured: false, linked: false, hasPassword: false },
    }),
  );
  await page.goto("/account");
  const google = page.getByRole("region", {
    name: "Google sign-in",
    exact: true,
  });
  await expect(
    google.getByText(/not configured on this Reach server/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Email address or username", { exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }).last(),
  ).toBeEnabled();
  await expect(google).toContainText(
    "does not request permission to read or send Gmail",
  );
  const button = google.getByRole("button", {
    name: "Continue with Google",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await expect(button.locator("img")).toHaveAttribute("src", "/google-g.png");
  await expect(button.locator("img")).toHaveJSProperty("complete", true);
  expect(
    await button
      .locator("img")
      .evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await button.click();
  const setup = google.getByRole("region", {
    name: "Connect Google sign-in",
    exact: true,
  });
  await expect(setup).toBeVisible();
  await expect(setup).toBeFocused();
  await expect(setup).toContainText(
    `${new URL(page.url()).origin}/api/auth/google/callback`,
  );
  await expect(setup).toContainText("GOOGLE_CLIENT_ID");
  await expect(setup).toContainText("GOOGLE_CLIENT_SECRET");
  await expect(setup.getByRole("textbox")).toHaveCount(0);
  expect(starts).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`google-${info.project.name}-unconfigured.png`),
    fullPage: true,
  });
});

test("real local OAuth startup requires consent and returns safely after synthetic Google cancellation", async ({
  page,
}, info) => {
  // Only the Google screen is intercepted. Reach start/state/cookie/callback are real.
  let authUrl: URL | undefined;
  let reachOrigin = "";
  let submitted: unknown;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/google/start")
      submitted = request.postDataJSON();
  });
  await page.route("https://accounts.google.com/**", async (route) => {
    authUrl = new URL(route.request().url());
    const callback = new URL(authUrl.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authUrl.searchParams.get("state")!);
    callback.searchParams.set("error", "access_denied");
    await route.fulfill({
      contentType: "text/html",
      body: `<h1>Synthetic Google consent — browser fixture</h1><a href="${callback.toString().replaceAll("&", "&amp;")}">Cancel synthetic sign-in</a>`,
    });
  });
  await page.goto("/account");
  reachOrigin = new URL(page.url()).origin;
  const google = page.getByRole("region", {
    name: "Google sign-in",
    exact: true,
  });
  const continueButton = google.getByRole("button", {
    name: "Continue with Google",
    exact: true,
  });
  await expect(continueButton).toBeDisabled();
  await google.getByRole("checkbox").check();
  await expect(continueButton).toBeEnabled();
  await page.screenshot({
    path: info.outputPath(`google-${info.project.name}-consent.png`),
    fullPage: true,
  });
  await continueButton.click();
  await expect(
    page.getByRole("heading", { name: /Synthetic Google consent/ }),
  ).toBeVisible();
  expect(submitted).toEqual({ intent: "signin", adultConfirmed: true });
  expect(authUrl!.searchParams.get("scope")).toBe("openid email profile");
  expect(authUrl!.searchParams.get("access_type")).toBe("online");
  expect(authUrl!.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authUrl!.searchParams.has("client_secret")).toBe(false);
  expect(authUrl!.searchParams.get("redirect_uri")).toBe(
    `${reachOrigin}/api/auth/google/callback`,
  );
  await page.getByRole("link", { name: "Cancel synthetic sign-in" }).click();
  await expect(page.getByText(/Google sign-in was cancelled/)).toBeVisible();
  await expect(
    page.getByLabel("Email address or username", { exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/account$/);
  const me = await page.request.get("/api/account/me");
  expect((await me.json()).user).toBeNull();
});

test("provider startup failure stays readable and leaves password login available", async ({
  page,
}) => {
  await page.route("**/api/auth/google/status", (route) =>
    route.fulfill({
      json: { configured: true, linked: false, hasPassword: false },
    }),
  );
  await page.route("**/api/auth/google/start", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: "Synthetic OAuth provider unavailable. No session created.",
      },
    }),
  );
  await page.goto("/account");
  const google = page.getByRole("region", {
    name: "Google sign-in",
    exact: true,
  });
  await google.getByRole("checkbox").check();
  await google
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await expect(google.getByRole("alert")).toContainText(
    "Synthetic OAuth provider unavailable",
  );
  await expect(
    google.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Email address or username", { exact: true }),
  ).toBeEnabled();
});

test("an existing Reach account must explicitly choose linking", async ({
  page,
}) => {
  let submitted: unknown;
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "synthetic-account",
          email: "fixture@gmail.com",
          emailVerified: true,
          name: "Synthetic existing member",
          role: "user",
        },
        preferences: {},
      },
    }),
  );
  await page.route("**/api/account/locations", (route) =>
    route.fulfill({ json: { locations: [] } }),
  );
  await page.route("**/api/pantries/favorites", (route) =>
    route.fulfill({ json: { pantries: [] } }),
  );
  await page.route("**/api/auth/google/status", (route) =>
    route.fulfill({
      json: { configured: true, linked: false, hasPassword: true },
    }),
  );
  await page.route("**/api/auth/google/start", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 503,
      json: { error: "Synthetic linking stop; no provider contacted." },
    });
  });
  await page.goto("/account");
  const google = page.getByRole("region", {
    name: "Google sign-in",
    exact: true,
  });
  await expect(
    google.getByRole("button", { name: "Link Google", exact: true }),
  ).toBeDisabled();
  await google.getByRole("checkbox").check();
  await google
    .getByRole("button", { name: "Link Google", exact: true })
    .click();
  await expect(google.getByRole("alert")).toContainText(
    "Synthetic linking stop",
  );
  expect(submitted).toEqual({ intent: "link", adultConfirmed: true });
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
});
