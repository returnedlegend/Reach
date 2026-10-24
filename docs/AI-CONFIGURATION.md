# AI provider configuration

AI assistance is server-side and remains unavailable until the operator accepts the data policy with `REACH_AI_DATA_POLICY_ACCEPTED=true`. Never expose provider credentials through `NEXT_PUBLIC_*` variables. Requests use a bounded timeout, strict structured output, local Zod validation, and no prompt or response logging. User-facing AI results still require review.

## OpenRouter

OpenRouter is the default only when its server key and a model are configured and `REACH_AI_PROVIDER` is unset. Setting `REACH_AI_PROVIDER=disabled` (or another unsupported provider) disables that inference route. The base URL is fixed to `https://openrouter.ai/api/v1`; `OPENROUTER_BASE_URL`, when set, must exactly equal that URL.

```dotenv
REACH_AI_DATA_POLICY_ACCEPTED=false
REACH_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_FAST_MODEL=
OPENROUTER_PRIMARY_MODEL=
OPENROUTER_MODEL=
OPENROUTER_FALLBACK_MODEL=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
REACH_AI_FREE_ONLY=true
REACH_AI_ALLOW_PAID=false
```

The fast and primary role variables take priority, followed by `OPENROUTER_MODEL` and legacy `REACH_AI_*_MODEL` aliases. Select an exact model ID after checking the current public catalog for `tools`, `structured_outputs`, and pricing. In free-only mode, every configured selected/fallback model must have a `:free` ID, explicit zero-valued pricing fields, and the required capabilities. Catalog checks are unauthenticated and do not perform inference. No model is hardcoded or automatically selected. The completion request also denies data-collecting providers, disables provider fallbacks, requires parameters, and applies zero price ceilings in free-only mode.

Paid OpenRouter requests require both `REACH_AI_FREE_ONLY=false` and `REACH_AI_ALLOW_PAID=true`. This only enables explicitly configured model IDs; it does not choose paid models automatically.

## Optional Gemini fallback

Gemini may be enabled as one explicit fallback for transient OpenRouter failures, or as the sole configured provider when OpenRouter credentials/model are absent. Both cases require all of these switches and credentials:

```dotenv
REACH_AI_GEMINI_FALLBACK=true
REACH_AI_DATA_POLICY_ACCEPTED=true
REACH_AI_FREE_ONLY=false
REACH_AI_ALLOW_PAID=true
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=
```

Gemini cannot be verified as free-only from a public account billing endpoint, so fallback is unavailable unless both paid-use controls are explicitly enabled. An authentication error, invalid model configuration, schema/output error, privacy failure, or OpenRouter `Retry-After` longer than the 500 ms request budget never triggers Gemini. Gemini receives no more than one attempt; when configured as an OpenRouter fallback, OpenRouter is limited to one attempt so the combined inference budget remains at two. The key is sent in the `x-goog-api-key` header, never in the URL. The documented REST adapter uses `generationConfig.responseFormat.text` with `mimeType: "APPLICATION_JSON"` and a JSON schema.

No fallback forwards content after a malformed or schema-invalid model response, preventing another model from masking invalid generated facts. Transient network, rate-limit, or 5xx failures may use the explicit Gemini fallback only after any short `Retry-After` has been honored. Long server-directed waits stop locally.

## Limits and verification

OpenRouter and Gemini do not share account billing controls. Keep account spending limits configured at the provider. Reach enforces process-local rate limits and a total eight-second deadline; counters reset on process restart and do not coordinate multiple application processes. Provider quotas, prices, capabilities, model IDs, and terms can change, so recheck official documentation and the live public catalog before enabling a model. Tests use mocked requests only; they do not establish account billing or live inference behavior.
