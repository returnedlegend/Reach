import { featureEnabled } from "./release-features";
/** Central server-side settings. Import only the type into browser code. */
if (typeof window !== "undefined")
  throw new Error("AI configuration is server-only.");

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
export type AIServiceStatus = {
  state: "configured" | "disabled" | "unavailable";
  code:
    | null
    | "disabled"
    | "privacy"
    | "credentials"
    | "configuration"
    | "cost-policy";
  message: string;
  model: string;
};
const first = (...values: Array<string | undefined>) =>
  values.find((value) => value?.trim())?.trim();
export function getOpenRouterModels(role: "fast" | "primary") {
  const suffix = role.toUpperCase();
  const selected =
    first(
      process.env[`OPENROUTER_${suffix}_MODEL`],
      process.env.OPENROUTER_MODEL,
      process.env[`REACH_AI_${suffix}_MODEL`],
      process.env.REACH_AI_MODEL,
    ) || DEFAULT_OPENROUTER_MODEL;
  const fallback = first(process.env.OPENROUTER_FALLBACK_MODEL) || "";
  return { selected, fallback: fallback !== selected ? fallback : "" };
}
export function isFreeOpenRouterModel(id: string) {
  return (
    id === DEFAULT_OPENROUTER_MODEL ||
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+:free$/.test(id)
  );
}
export function isFreeOpenRouterProfile(role: "fast" | "primary") {
  // A free model/router never unlocks paid fallbacks, even with stale legacy flags.
  return (
    isFreeOpenRouterModel(getOpenRouterModels(role).selected) ||
    process.env.REACH_AI_FREE_ONLY !== "false"
  );
}
export function openRouterKeyConfigured() {
  const key = process.env.OPENROUTER_API_KEY || "";
  return !!key.trim() && !/placeholder|your_openrouter_api/i.test(key);
}
/** Configuration only; this endpoint never promises live availability or billing. */
export function getAIServiceStatus(): AIServiceStatus {
  const model = getOpenRouterModels("fast").selected;
  const result = (
    state: AIServiceStatus["state"],
    code: AIServiceStatus["code"],
    message: string,
  ): AIServiceStatus => ({ state, code, message, model });
  const provider = process.env.REACH_AI_PROVIDER?.toLowerCase();
  if (!featureEnabled("ai") || provider === "disabled")
    return result(
      "disabled",
      "disabled",
      "AI is turned off. Pantry search, map directions and manual trip controls remain available.",
    );
  if (provider && provider !== "openrouter")
    return result(
      "unavailable",
      "configuration",
      "Free OpenRouter assistance is not selected. Use the manual trip controls.",
    );
  if (!openRouterKeyConfigured())
    return result(
      "unavailable",
      "credentials",
      "Free AI is not connected yet. The site owner needs to configure its server API key; manual planning still works.",
    );
  if (process.env.REACH_AI_DATA_POLICY_ACCEPTED !== "true")
    return result(
      "unavailable",
      "privacy",
      "AI is off until the site owner reviews the provider data policy. Manual planning still works.",
    );
  if (
    (process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL) !==
    OPENROUTER_BASE_URL
  )
    return result(
      "unavailable",
      "configuration",
      "The AI service configuration is invalid. Use manual planning while the site owner checks it.",
    );
  const models = [
    getOpenRouterModels("fast"),
    getOpenRouterModels("primary"),
  ].flatMap(({ selected, fallback }) => [selected, fallback].filter(Boolean));
  if (!models.every(isFreeOpenRouterModel))
    return result(
      "unavailable",
      "cost-policy",
      "Free AI requires a free router or free model for every configured role and fallback. Manual planning still works.",
    );
  return result(
    "configured",
    null,
    "Free OpenRouter assistance is configured. Free-model capacity and compatible providers may be unavailable; computed planning remains available.",
  );
}
