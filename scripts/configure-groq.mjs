import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Explicit operator action only. Keeps keys and unrelated configuration unchanged. */
export function configureGroqEnvironment(text) {
  const values = {
    REACH_AI_PROVIDER: "groq",
    REACH_RELEASE_AI: "true",
    GROQ_API_KEY: "your_groq_api_key_here",
    GROQ_MODEL: "openai/gpt-oss-20b",
    GROQ_TIMEOUT_MS: "20000",
    REACH_AI_DATA_POLICY_ACCEPTED: "false",
  };
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    if (pattern.test(result)) {
      if (["REACH_AI_PROVIDER", "REACH_RELEASE_AI"].includes(key))
        result = result.replace(pattern, `${key}=${value}`);
    } else {
      result += `${result.endsWith("\n") || !result ? "" : "\n"}${key}=${value}\n`;
    }
  }
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const path = join(root, ".env.local");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, configureGroqEnvironment(text), { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(
    "Selected Groq in .env.local. Existing keys and unrelated values were preserved. Add your private GROQ_API_KEY there and review Groq's data policy before setting REACH_AI_DATA_POLICY_ACCEPTED=true. Restart Reach, then run npm run ai:check -- --generate. Shell/deployment variables override this file.",
  );
}
