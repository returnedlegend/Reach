import { CORE_FEATURES, type PublicFeatures } from "./public-feature-types";

if (typeof window !== "undefined")
  throw new Error("Release configuration is server-only.");

/** Production defaults to the anonymous core. Invalid settings fail closed. */
export function coreRelease(): boolean {
  const profile = process.env.REACH_RELEASE_PROFILE;
  if (profile) return profile !== "extended";
  return process.env.NODE_ENV === "production";
}
export function featureEnabled(feature: keyof PublicFeatures): boolean {
  // Local AI can be explicitly enabled in the anonymous core without enabling accounts.
  const profile = process.env.REACH_RELEASE_PROFILE;
  if (
    feature === "ai" &&
    (!profile || ["core", "extended"].includes(profile)) &&
    process.env.REACH_RELEASE_AI === "true" &&
    (process.env.REACH_AI_PROVIDER?.trim().toLowerCase() || "ollama") ===
      "ollama"
  )
    return true;
  if (coreRelease()) return false;
  if (
    process.env.NODE_ENV === "production" &&
    process.env[`REACH_RELEASE_${feature.toUpperCase()}`] !== "true"
  )
    return false;
  const accounts =
    process.env.REACH_ACCOUNT_ENABLED !== "false" &&
    (process.env.NODE_ENV !== "production" ||
      process.env.REACH_RELEASE_ACCOUNTS === "true");
  const community =
    process.env.REACH_COMMUNITY_ENABLED === "true" &&
    (process.env.NODE_ENV !== "production" ||
      process.env.REACH_RELEASE_COMMUNITY === "true");
  switch (feature) {
    case "accounts":
      return accounts;
    case "google":
      return (
        accounts &&
        Boolean(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
        )
      );
    case "community":
      return community;
    case "volunteering":
      return community && accounts;
    case "email":
      return accounts && process.env.REACH_EMAIL_PROVIDER !== "disabled";
    case "ai":
      return process.env.REACH_AI_PROVIDER !== "disabled";
  }
}
/** Availability/configuration, not proof of successful live provider service. */
export function publicFeatures(): PublicFeatures {
  const aiProvider =
    process.env.REACH_AI_PROVIDER?.trim().toLowerCase() || "ollama";
  const aiKey =
    aiProvider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : aiProvider === "gemini"
        ? process.env.GEMINI_API_KEY
        : aiProvider === "groq"
          ? process.env.GROQ_API_KEY
          : undefined;
  const configuredAI =
    process.env.REACH_AI_DATA_POLICY_ACCEPTED === "true" &&
    (aiProvider === "ollama" || Boolean(aiKey?.trim())) &&
    !/placeholder|your[_-].*(?:key|here)/i.test(aiKey || "");
  const emailProvider = process.env.REACH_EMAIL_PROVIDER;
  const configuredMail =
    emailProvider === "preview"
      ? process.env.NODE_ENV !== "production"
      : emailProvider === "smtp"
        ? Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM_EMAIL)
        : Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  return {
    accounts: featureEnabled("accounts"),
    google: featureEnabled("google"),
    email: featureEnabled("email") && configuredMail,
    community: featureEnabled("community"),
    volunteering: featureEnabled("volunteering"),
    ai: featureEnabled("ai") && configuredAI,
  };
}
export function disabledFeatureResponse(feature: string): Response {
  return Response.json(
    {
      code: "feature_disabled",
      message: `${feature} is not part of this release. Finding food and saving directions do not require it.`,
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
