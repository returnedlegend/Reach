import { expect, it } from "vitest";
import { configureGroqEnvironment } from "../scripts/configure-groq.mjs";
it("switches stale Ollama selection while preserving private keys and policy choice", () => {
  const old =
    "REACH_AI_PROVIDER=ollama\nREACH_RELEASE_AI=false\nGROQ_API_KEY=synthetic-private-value\nSMTP_PASSWORD=synthetic-mail-value\nREACH_AI_DATA_POLICY_ACCEPTED=false\n";
  const updated = configureGroqEnvironment(old);
  expect(updated).toContain("REACH_AI_PROVIDER=groq");
  expect(updated).toContain("REACH_RELEASE_AI=true");
  expect(updated).toContain("GROQ_API_KEY=synthetic-private-value");
  expect(updated).toContain("SMTP_PASSWORD=synthetic-mail-value");
  expect(updated).toContain("REACH_AI_DATA_POLICY_ACCEPTED=false");
  expect(configureGroqEnvironment(updated)).toBe(updated);
});
it("new configuration uses a placeholder and requires policy review", () => {
  expect(configureGroqEnvironment("")).toContain(
    "GROQ_API_KEY=your_groq_api_key_here",
  );
  expect(configureGroqEnvironment("")).toContain(
    "REACH_AI_DATA_POLICY_ACCEPTED=false",
  );
});
