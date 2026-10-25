import { featureEnabled } from "./release-features";

/** Server-only configuration. Browser code may import the status type only. */
if (typeof window !== "undefined")
  throw new Error("AI configuration is server-only.");

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEFAULT_DEEPSEEK_REASONING_MODEL = "deepseek-v4-pro";
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

export function usesLlama() {
  return (
    (process.env.REACH_AI_PROVIDER?.trim().toLowerCase() || "ollama") ===
    "ollama"
  );
}
/** Ollama is local-only: never forward cloud credentials to this endpoint. */
export function getOllamaBaseUrl(): string | null {
  const raw =
    process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434/v1";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]", "ollama"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.replace(/\/$/, "") === "/v1"
      ? raw.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}
export function getDeepSeekModels(role: "fast" | "primary") {
  if (usesLlama())
    return { selected: process.env.OLLAMA_MODEL?.trim() || "llama3.2:3b" };
  return {
    selected:
      role === "primary"
        ? process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
          DEFAULT_DEEPSEEK_REASONING_MODEL
        : process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
  };
}
export function deepSeekKeyConfigured() {
  const key = process.env.DEEPSEEK_API_KEY?.trim() || "";
  return (
    Boolean(key) &&
    !/placeholder|your[_-].*(?:key|here)|^your_key_here$/i.test(key)
  );
}
/** Restrict credentials to the official service. /v1 is an officially supported alias. */
export function getDeepSeekBaseUrl(): string | null {
  const base = (
    process.env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_BASE_URL
  ).replace(/\/$/, "");
  return base === DEEPSEEK_BASE_URL || base === `${DEEPSEEK_BASE_URL}/v1`
    ? base
    : null;
}
export function getDeepSeekTimeoutMs(): number | null {
  const raw = usesLlama()
    ? process.env.OLLAMA_TIMEOUT_MS
    : process.env.DEEPSEEK_TIMEOUT_MS;
  if (raw === undefined || raw === "") return usesLlama() ? 40_000 : 12_000;
  if (!/^\d+$/.test(raw)) return null;
  const timeout = Number(raw);
  return timeout >= 1_000 && timeout <= (usesLlama() ? 60_000 : 20_000)
    ? timeout
    : null;
}
/** Called before delivery and by /api/ai/status; configuration is not a live health check. */
export function getAIServiceStatus(): AIServiceStatus {
  const model = getDeepSeekModels("fast").selected;
  const result = (
    state: AIServiceStatus["state"],
    code: AIServiceStatus["code"],
    message: string,
  ): AIServiceStatus => ({ state, code, message, model });
  const provider = process.env.REACH_AI_PROVIDER?.trim().toLowerCase();
  if (!featureEnabled("ai") || provider === "disabled")
    return result(
      "disabled",
      "disabled",
      "AI is turned off. Pantry search, map directions and manual trip controls remain available.",
    );
  if (usesLlama()) {
    if (process.env.REACH_AI_DATA_POLICY_ACCEPTED !== "true")
      return result(
        "unavailable",
        "privacy",
        "Review local AI processing settings before enabling assistance.",
      );
    if (
      !getOllamaBaseUrl() ||
      !getDeepSeekTimeoutMs() ||
      !/^llama3\.2(?::(?:1b|3b))?$/.test(model)
    )
      return result(
        "unavailable",
        "configuration",
        "Check the local Ollama URL, Llama 3.2 model and timeout. Manual planning remains available.",
      );
    return result(
      "configured",
      null,
      "Local Llama 3.2 is configured. Ollama must be running with the model installed; manual planning remains available.",
    );
  }
  if (provider && provider !== "deepseek")
    return result(
      "unavailable",
      "configuration",
      "DeepSeek assistance is not selected. Use the manual trip controls.",
    );
  if (!deepSeekKeyConfigured())
    return result(
      "unavailable",
      "credentials",
      "AI is not connected yet. The site owner needs to configure DEEPSEEK_API_KEY on the server; manual planning still works.",
    );
  if (process.env.REACH_AI_DATA_POLICY_ACCEPTED !== "true")
    return result(
      "unavailable",
      "privacy",
      "AI is off until the site owner reviews the DeepSeek data policy. Manual planning still works.",
    );
  if (
    !getDeepSeekBaseUrl() ||
    !getDeepSeekTimeoutMs() ||
    ![model, getDeepSeekModels("primary").selected].every((id) =>
      /^deepseek-[a-zA-Z0-9._-]{1,80}$/.test(id),
    )
  )
    return result(
      "unavailable",
      "configuration",
      "Check the official DeepSeek URL, model IDs and timeout on the server. Manual planning still works.",
    );
  return result(
    "configured",
    null,
    "DeepSeek assistance is configured. Provider availability and account balance still apply; computed planning remains available.",
  );
}
