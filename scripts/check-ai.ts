import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const { getAIServiceStatus, usesGroq, GROQ_BASE_URL } = await import(
  "../src/lib/ai-config"
);
const status = getAIServiceStatus();
console.log(`Reach AI: ${status.state}. ${status.message}`);
if (!usesGroq() || status.state !== "configured") {
  console.log(
    "Set REACH_AI_PROVIDER=groq and a private GROQ_API_KEY in .env.local. Review Groq's data policy before setting REACH_AI_DATA_POLICY_ACCEPTED=true. Enable REACH_RELEASE_AI=true, then restart Reach.",
  );
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!.trim()}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      console.log(
        `Groq model check failed (HTTP ${response.status}). Check the API key, account access and quota. Credentials and response bodies are not logged.`,
      );
      process.exitCode = 1;
    } else {
      const body = (await response.json()) as { data?: { id: string }[] };
      if (!body.data?.some((model) => model.id === status.model)) {
        console.log(
          "The configured GROQ_MODEL was not listed for this account. Check the Groq console.",
        );
        process.exitCode = 1;
      } else {
        console.log(
          `Groq lists configured model ${status.model}. This does not yet verify generation.`,
        );
        if (process.argv.includes("--generate")) {
          const { z } = await import("zod");
          const { deepseekJson } = await import("../src/lib/deepseek-client");
          const schema = z.object({ message: z.string().max(100) }).strict();
          const result = await deepseekJson({
            role: "fast",
            feature: "ranking",
            maxAttempts: 1,
            schema,
            jsonSchema: z.toJSONSchema(schema),
            prompt: 'Return JSON {"message":"Ready to compare food options."}.',
          });
          console.log(
            result.status === "available"
              ? "Structured generation succeeded using synthetic input."
              : result.reason,
          );
          if (result.status !== "available") process.exitCode = 1;
        }
      }
    }
  } catch {
    console.log(
      "Groq could not be reached within the request deadline. Check the Reach server's network connection.",
    );
    process.exitCode = 1;
  }
}
