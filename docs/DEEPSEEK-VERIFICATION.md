# DeepSeek migration verification

The direct DeepSeek integration has independent synthetic coverage for its
server request boundary, configuration gates, structured output handling,
retry behavior and aggregate usage reporting. These checks use a stubbed
`fetch`; they do not contact DeepSeek or establish live service availability,
account balance, model access or production readiness.

The independent client checks confirm that requests use the official
`https://api.deepseek.com/chat/completions` endpoint (or its official `/v1`
alias), keep the API key in the authorization header, use JSON mode, and apply
the requested Zod schema before returning model output. They also cover the
separate fast and reasoning model settings, privacy and credential gates,
caller cancellation, the configured deadline, one bounded retry for transient
HTTP responses, and no retry after an ambiguous network failure. Usage
snapshots contain aggregate counts and token totals only; they omit prompts,
responses, account identifiers and estimated cost.

Release feature coverage checks that AI configuration requires the selected
provider's server key, accepted data policy and release attestation. Release
preflight coverage confirms that an extended production configuration can
select DeepSeek while the core release remains AI-off.

The locally verified subset is:

```text
npx vitest run tests/deepseek-independent.test.ts tests/release-features.test.ts tests/release-preflight.test.ts
27 tests passed
npx prettier --check tests/deepseek-independent.test.ts tests/release-features.test.ts tests/release-preflight.test.ts
passed
```

On the isolated production preview at `https://localhost:3443`, the system
Chromium browser fetched `/api/ai/status` and observed `configured` with the
model name only; no key appeared in the response. Four desktop Playwright cases
passed against mocked `/api/food-search` responses: normal interpretation,
provider outage with directory results retained, AI opt-out during a pending
response, and a manual travel choice winning over pending AI output. A separate
browser request selected coordinates, enabled AI, and submitted synthetic text;
the intercepted request body contained only `{ "message": "Synthetic food
request", "useAI": true }`, with no coordinates. These checks made no provider
inference request, mail send or database mutation.

The dated provider check in [`evidence/deepseek-live-check.json`](evidence/deepseek-live-check.json)
made three requests to `api.deepseek.com/chat/completions` with synthetic public
inputs. DeepSeek returned HTTP 402 for all three, indicating insufficient
account balance. No inference succeeded; accepted output and usage tokens were
zero. The account's configured status therefore establishes only local
configuration, not usable balance or live model readiness. With inference
unavailable, the inquiry path returned an editable template draft and did not
send email. The check included no coordinates or personal information and did
not deploy or send a message.

Manual workflow and provider readiness still require a deployment-specific
review of the privacy policy, secret provisioning, release attestation and
account balance. The public status reports configuration; it is not a live
health check.
