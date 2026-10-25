# DeepSeek AI setup

Reach's optional AI features use DeepSeek's official OpenAI-compatible Chat Completions API. The default model is `deepseek-flash`; the higher-capability reasoning model is `deepseek-v4-pro`. Both are paid API models. AI stays disabled until a server key is configured and the operator explicitly accepts the data policy.

## Configure

Use Node 24, run `npm ci`, and start with `npm run dev`. This workspace has a root `.env` with DeepSeek placeholders. Next loads `.env.local` with higher priority than `.env`; the existing ignored `.env.local` retains other settings and credentials. Preserve it and edit only the relevant DeepSeek values there when an override is needed. On a fresh installation, use `.env.example` to create the local environment file.

```dotenv
REACH_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=12000
REACH_AI_DATA_POLICY_ACCEPTED=false
```

Create an API key in the DeepSeek platform and enter it privately in `DEEPSEEK_API_KEY`. Keep it out of chat, Git, screenshots, downloaded archives and all `NEXT_PUBLIC_*` variables. Review the current provider terms and privacy information before setting `REACH_AI_DATA_POLICY_ACCEPTED=true`. Restart Reach after changing server settings. The server validates the configuration at startup and before requests; missing or invalid settings produce a safe console warning and an unavailable status without disabling pantry browsing. `REACH_AI_PROVIDER=disabled` keeps inference off. An unset or invalid key, unaccepted policy or invalid configuration leaves deterministic/manual behavior available.

For a production build, the anonymous `core` profile deliberately hides AI. After the AI checks pass, enable only the AI release gate in the runtime environment:

```dotenv
REACH_RELEASE_PROFILE=extended
REACH_RELEASE_AI=true
```

Leave other `REACH_RELEASE_*` gates at their current reviewed values. Run `npm run check`, then `npm start` for a local production preview. For the existing HTTPS/Docker deployment, update the private runtime environment and rebuild/restart using [Publishing Reach](PUBLISHING.md). Restarting does not fund the DeepSeek account: HTTP 402 requires an account balance change by the owner.

`DEEPSEEK_TIMEOUT_MS` accepts values from 1,000 to 20,000 milliseconds and defaults to 12,000. A single request, including a reasoning request, uses that same total deadline. Fast requests use a 1,600-token output limit with thinking disabled. Complex guidance may use the reasoning model with a 4,096-token limit and low thinking effort. Both model IDs are configurable. Reach does not automatically switch providers or try another provider after an error. It may make at most two attempts for HTTP 429 or 5xx responses, using 250 ms exponential backoff and honoring `Retry-After` up to two seconds within the request deadline. Ambiguous network failures are not retried. Set `REACH_AI_USAGE_LOGGING=true` only to log aggregate usage counts; no prompts, responses or model keys are logged.

## Model capabilities, structured output and thinking

The current official model names are `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro` (DeepSeek-V4-Pro-0813). The API supports both thinking and non-thinking modes for these models. Thinking effort values supported by both are `low`, `high` and `max`; the documented default is `high`. The `none` effort disables thinking. Reach bounds the full request by its configured timeout and validates returned data against its local schemas.

DeepSeek's JSON Output mode uses `response_format: {"type":"json_object"}`. It guarantees valid JSON syntax, not conformance to an application schema. The provider asks callers to include the word “json” and an example in the prompt, choose a sufficient output limit, and account for occasional empty content. Reach must continue validating every response locally and fall back to deterministic behavior on invalid or empty output.

Function tool calls are a separate API feature. DeepSeek's strict tool-call schema mode is beta and requires the `/beta` base URL and `strict: true` on each function; its supported JSON Schema subset has additional constraints. Reach does not give model output authority to execute arbitrary tools, send messages or create service facts.

## Cost, capacity and retries

DeepSeek bills input and output tokens against the account balance. The official pricing page checked October 25, 2026 lists these per-million-token prices; off-peak prices are half the peak prices:

| Model             | Input cache hit, peak | Input cache miss, peak | Output, peak |
| ----------------- | --------------------: | ---------------------: | -----------: |
| `deepseek-flash`  |                $0.006 |                  $0.30 |        $1.20 |
| `deepseek-v4-pro` |                $0.044 |                  $1.32 |        $3.96 |

Prices can change; check the current [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) page and use account spending controls. Reach's process-local budgets cap attempts at 128/day and 20/minute overall, with 32/day and 5/minute per feature by default. Those limits reset on restart, do not coordinate multiple instances, and do not cap dollar spending. Set provider-side balance/spending controls as well.

DeepSeek currently documents concurrency limits of 2,500 for Flash and 500 for Pro per account; excess concurrency returns HTTP 429. Its error guide lists 400/422 for invalid requests, 401 for authentication, 402 for insufficient balance, 429 for rate/concurrency limits, and 500/503 for server or overload errors. Correct request/configuration and billing errors are not retried. The client retries only 429 and 5xx responses, at most once after a 250 ms exponential backoff, honoring `Retry-After` up to two seconds and the overall deadline. It does not retry ambiguous network failures. A 500 or 503 may be transient, but repeated attempts can incur usage.

The isolated live check on October 25, 2026 sent three synthetic requests to the official endpoint; all three returned HTTP 402 for insufficient balance. Needs and reasoning were unavailable, and outreach drafting retained its template. No email was sent, and no successful live completion is claimed. See the [DeepSeek migration verification](DEEPSEEK-VERIFICATION.md) and [recorded live-check evidence](evidence/deepseek-live-check.json).

## Privacy and user data

AI requests disclose submitted content to DeepSeek. The submitted fields depend on the feature: preference interpretation may send the optional text the user submits; outreach drafting sends the recipient name and a question after location and sensitive-content checks; guidance receives generated public route timings, totals and availability uncertainty, rather than the user's origin or raw routing instructions. When AI is configured, enabled and the data-policy acknowledgement is accepted, reply extraction may send up to 6,000 characters of unquoted reply text after local extraction, negation checks and a heuristic location check. The prompt treats reply content as untrusted data and asks for an exact supporting substring; returned facts must match text in the message, and AI cannot increase availability or date confidence beyond the local extraction. These checks do not guarantee detection of personal information. Avoid sending identifying or sensitive content. Reach does not log prompts or provider error bodies.

DeepSeek's [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) says its consumer-services policy does not cover personal data processed in downstream applications built with its open-platform services and says developers should disclose their own privacy policies. It also advises users not to submit sensitive personal data to its services. Review the terms applicable to the API account and decide whether this processing is appropriate for Reach users; do not describe the integration as zero-retention or private from the provider. The API supports an optional `user_id` for safety, cache and scheduling isolation, but it must be an opaque identifier and must not contain personal information.

## Official documentation

- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit)
- [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)
- [Change Log](https://api-docs.deepseek.com/updates)
