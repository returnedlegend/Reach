/** Validate optional server AI settings at startup without making a paid request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getAIServiceStatus } = await import("./lib/ai-config");
  const status = getAIServiceStatus();
  if (status.state === "unavailable") {
    // Static messages only: never log credentials, submitted text or provider error bodies.
    console.warn(`[ReachAI configuration: ${status.code}] ${status.message}`);
  }
}
