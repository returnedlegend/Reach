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
  // Account-free moderated sharing is a core public feature; legacy flags no longer hide it.
  if (feature === "community") return true;
  // Selected AI can be explicitly enabled in the anonymous core without enabling accounts.
  const profile = process.env.REACH_RELEASE_PROFILE;
  if (
    feature === "ai" &&
    (!profile || ["core", "extended"].includes(profile)) &&
    process.env.REACH_RELEASE_AI === "true" &&
    ["ollama", "groq"].includes(
      process.env.REACH_AI_PROVIDER?.trim().toLowerCase() || "groq",
    )
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
    process.env.REACH_AI_PROVIDER?.trim().toLowerCase() || "groq";
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
  return {
    accounts: false,
    google: false,
    email: false,
    community: featureEnabled("community"),
    volunteering: false,
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
