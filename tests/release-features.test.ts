import { afterEach, describe, expect, it, vi } from "vitest";
import { coreRelease, publicFeatures } from "../src/lib/release-features";
import { CORE_FEATURES } from "../src/lib/public-feature-types";
import { emailDeliveryMode } from "../src/lib/mail-delivery";
import { getAIServiceStatus } from "../src/lib/ai-config";
import { createAccountHandler } from "../src/lib/account";
import { createVolunteerHandler } from "../src/lib/volunteer";
import { createOutreachHandler } from "../src/lib/outreach";
import { createAssistantHandler } from "../src/lib/reach-assistant";
afterEach(() => vi.unstubAllEnvs());
describe("public core release boundary", () => {
  it("defaults production to the core even with stale enabled flags and installed credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REACH_RELEASE_PROFILE", "");
    vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
    vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
    vi.stubEnv("REACH_EMAIL_PROVIDER", "smtp");
    vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
    expect(coreRelease()).toBe(true);
    expect(publicFeatures()).toEqual(CORE_FEATURES);
    expect(emailDeliveryMode()).toBe("disabled");
    expect(getAIServiceStatus().state).toBe("disabled");
  });
  it("keeps public sharing enabled when a stale environment flag says false", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REACH_RELEASE_PROFILE", "core");
    vi.stubEnv("REACH_COMMUNITY_ENABLED", "false");
    expect(publicFeatures().community).toBe(true);
    expect(publicFeatures().accounts).toBe(false);
  });
  it("fails closed for an invalid profile, while explicit extended retains configured features", () => {
    vi.stubEnv("REACH_RELEASE_PROFILE", "typo");
    expect(publicFeatures()).toEqual(CORE_FEATURES);
    expect(publicFeatures().community).toBe(true);
    vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
    vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
    vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
    expect(coreRelease()).toBe(false);
    expect(publicFeatures().accounts).toBe(false);
    expect(publicFeatures().community).toBe(true);
  });
  it("requires a separate production release attestation for each optional feature", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
    vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
    vi.stubEnv("REACH_RELEASE_ACCOUNTS", "false");
    expect(publicFeatures().accounts).toBe(false);
    expect(publicFeatures().community).toBe(true);
    vi.stubEnv("REACH_RELEASE_ACCOUNTS", "true");
    expect(publicFeatures().accounts).toBe(false);
    expect(publicFeatures().email).toBe(false);
    expect(publicFeatures().ai).toBe(false);
  });
  it("publishes AI only when DeepSeek credentials and the privacy gate are configured", () => {
    vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
    vi.stubEnv("REACH_RELEASE_AI", "true");
    vi.stubEnv("REACH_AI_PROVIDER", "deepseek");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-deepseek-key");
    expect(publicFeatures().ai).toBe(true);

    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");
    expect(publicFeatures().ai).toBe(false);

    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-deepseek-key");
    vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "false");
    expect(publicFeatures().ai).toBe(false);
  });
  it("rejects direct optional API calls before opening storage or invoking providers", async () => {
    vi.stubEnv("REACH_RELEASE_PROFILE", "core");
    const request = () =>
      new Request("https://reach.example/api/test", {
        method: "POST",
        headers: {
          Origin: "https://reach.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const impossiblePath = "/no-access/release-test.sqlite";
    expect(
      (await createAccountHandler(impossiblePath)(request(), ["login"])).status,
    ).toBe(503);
    expect(
      (await createVolunteerHandler(impossiblePath)(request(), [])).status,
    ).toBe(404);
    expect(
      (await createOutreachHandler(impossiblePath)(request(), [])).status,
    ).toBe(404);
    const plan = vi.fn();
    expect(
      (await createAssistantHandler(impossiblePath, { plan })(request()))
        .status,
    ).toBe(404);
    expect(plan).not.toHaveBeenCalled();
    const status = await createAccountHandler(impossiblePath)(
      new Request("https://reach.example/api/account/status"),
      ["status"],
    );
    expect(await status.json()).toMatchObject({
      enabled: false,
      emailConfigured: false,
      deliveryMode: "disabled",
    });
  });
});

it("allows explicitly enabled local AI in core without enabling account or community features", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REACH_RELEASE_PROFILE", "core");
  vi.stubEnv("REACH_RELEASE_AI", "true");
  vi.stubEnv("REACH_AI_PROVIDER", "ollama");
  vi.stubEnv("REACH_AI_DATA_POLICY_ACCEPTED", "true");
  expect(publicFeatures()).toEqual({ ...CORE_FEATURES, ai: true });
  expect(getAIServiceStatus().state).toBe("configured");
  vi.stubEnv("REACH_AI_PROVIDER", "disabled");
  expect(publicFeatures().ai).toBe(false);
});
