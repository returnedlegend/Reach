# Groq hosted AI

Groq replaces local Ollama as Reach's default provider. No local model download or extra package is needed: the existing server-only client uses Groq's official OpenAI-compatible Chat Completions API at `https://api.groq.com/openai/v1/chat/completions`. The historical `deepseekJson` function name is retained for compatibility across existing workflows. Explicit legacy providers remain supported; there is no automatic provider fallback.

## Setup

Create an API key at https://console.groq.com/keys and put it in the project's ignored `.env.local`:

```ini
REACH_AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=20000
REACH_RELEASE_AI=true
# Set true only after reviewing Groq's data processing terms:
REACH_AI_DATA_POLICY_ACCEPTED=true
```

Preserve unrelated settings. Never use a NEXT_PUBLIC prefix for the key or commit `.env.local`. Existing installations must change `REACH_AI_PROVIDER=ollama` to `groq`. Restart Reach after editing configuration. Deployment environment variables override local file values.

Run `npm run ai:check` to check account/model access; run `npm run ai:check -- --generate` for a small synthetic generation test. Neither prints the API key or provider response body.

## Behavior and limits

The selected model is listed in Groq's current supported-model documentation. JSON object mode plus Zod validation protects the application's response contract. GPT-OSS uses low reasoning effort and a 2,048-token ranking budget including reasoning. The hosted deadline is 20 seconds (configurable 1–20 seconds). Existing per-feature quotas, circuit breaker, response limits, cancellation and no-redirect credential handling remain in effect. Missing keys, exhausted quotas, network errors and invalid responses produce honest unavailable states; mathematical pantry results remain usable.

Ranking remains based on recorded distance, pickup schedules and evidence. AI interprets requests and produces short comparisons, not new pantry facts. Approved community pickups and household sharing continue through the same directory. No raw origin coordinates are sent by the ranking pipeline; request text, public candidate facts, derived distances and scores go to Groq. Users should not include private details in prompts. AI can be disabled without losing search.

Use a free-plan account if you want to avoid charges. Reach cannot verify your billing plan or promise unlimited free use. A paid Groq account may bill these same calls. Check account limits and billing controls in the Groq console; no automatic paid/provider fallback is implemented. `REACH_AI_FREE_ONLY` is a legacy setting for the retained Gemini adapter, not a guarantee of Groq pricing.

Official references checked for this migration:
- https://console.groq.com/docs/models
- https://console.groq.com/docs/structured-outputs (JSON object mode requires explicit JSON instructions and application schema validation)
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/your-data

Live generation remains unverified until a real configured key succeeds. Tests use synthetic responses and do not establish provider availability.
