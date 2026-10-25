import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const { getAIServiceStatus, getOllamaBaseUrl, usesLlama } = await import("../src/lib/ai-config");
const status = getAIServiceStatus();
console.log(`Reach AI: ${status.state}. ${status.message}`);
if (!usesLlama()) {
  console.log("This diagnostic checks local Ollama only. REACH_AI_PROVIDER is not ollama.");
  process.exitCode = 1;
} else {
  const base = getOllamaBaseUrl();
  if (!base) {
    console.log("Set OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 for Ollama on this computer.");
    process.exitCode = 1;
  } else {
    try {
      const response = await fetch(`${new URL(base).origin}/api/tags`, {
        signal: AbortSignal.timeout(5000), redirect: "error",
      });
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json() as {models?: {name:string}[]};
      const names = body.models?.map(model => model.name) ?? [];
      const target = status.model.includes(":") ? status.model : `${status.model}:latest`;
      console.log("Ollama is reachable from the Reach server.");
      if (names.includes(target)) console.log(`Configured model ${target} is installed.`);
      else {
        console.log(`Configured model ${target} is not installed. Run: ollama pull ${target}`);
        process.exitCode = 1;
      }
      if (status.state !== "configured") {
        console.log("Check .env.local: REACH_AI_PROVIDER=ollama, REACH_RELEASE_AI=true, REACH_AI_DATA_POLICY_ACCEPTED=true (after reviewing the local AI policy), then restart Reach.");
        process.exitCode = 1;
      }
      if (process.argv.includes("--generate") && !process.exitCode) {
        console.log("Testing one small structured response; this may load the model. No personal information is sent.");
        const { z } = await import("zod");
        const { deepseekJson } = await import("../src/lib/deepseek-client");
        const schema = z.object({message:z.string().max(100)}).strict();
        const start = Date.now();
        const result = await deepseekJson({role:"primary",feature:"ranking",nativeSchema:true,maxAttempts:1,
          schema,jsonSchema:z.toJSONSchema(schema),prompt:'Return {"message":"Ready to summarize food options."} as JSON.'});
        console.log(result.status === "available" ? `Structured generation succeeded in ${Math.round((Date.now()-start)/1000)} seconds.` : result.reason);
        if(result.status !== "available") process.exitCode = 1;
      }
    } catch {
      console.log("Reach cannot reach Ollama within 5 seconds. Open the Ollama app or run ollama serve on this computer. If Reach runs in Docker, use the documented Ollama container hostname. Restart Reach after changing settings.");
      process.exitCode = 1;
    }
  }
}
