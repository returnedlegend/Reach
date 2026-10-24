# Free OpenRouter assistance

Reach uses `openrouter/free` as the default for its existing assistant, preference interpretation, evidence-based recommendation guidance, inquiry drafts and reply extraction. No application or email provider was replaced. The latest GitHub changes were fetched and fast-forwarded from `dce920b` to `8b8d8bc` before implementation; the updated discovery UI, origin protection, database lifecycle and reviewed-email controls remain in place.

## Setup

Use Node 24. Run `npm ci` in the project root. On a new installation copy `.env.example` to `.env.local`; preserve an existing file. The actual ignored root `.env.local` exists in this workspace, has mode 0600, and its free-profile settings were updated without exposing or replacing credentials, Google settings, mail settings, or the existing privacy acknowledgement.

Set these **server-only** variables:

```dotenv
REACH_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_FAST_MODEL=
OPENROUTER_PRIMARY_MODEL=
OPENROUTER_FALLBACK_MODEL=
REACH_AI_FREE_ONLY=true
REACH_AI_ALLOW_PAID=false
REACH_AI_GEMINI_FALLBACK=false
REACH_AI_DATA_POLICY_ACCEPTED=false
```

Create a key in your OpenRouter account and enter it privately in `OPENROUTER_API_KEY`, either in `.env.local` or secure direct environment settings. Never put it in chat, GitHub, a browser variable, a screenshot or a downloaded archive. Review the provider terms and data handling before deliberately changing `REACH_AI_DATA_POLICY_ACCEPTED=true`. Restart Reach after changes. An explicit `REACH_AI_PROVIDER=disabled` overrides otherwise valid settings.

An empty model setting defaults to `openrouter/free`. Nonblank role settings take precedence over the general setting, followed by legacy model aliases; review older overrides if a different model appears to be selected. You may deliberately select an exact `:free` model instead. No unrestricted `openrouter/auto` model is allowed, and the free profile never appends a paid model list. Keep the optional fallback blank or explicitly free.

Start with `npm run dev`, open the existing **Reach AI assistant**, and choose an actual starting location for route questions. Its availability notice distinguishes configuration from a verified model response. `GET /api/ai/status` is a private/no-store **configuration** check: it does not perform inference, verify account quota or promise service availability. Missing credentials, disabled AI, unaccepted policy and invalid configuration leave manual planning available.

## Cost and response boundaries

- The public OpenRouter catalog must list every requested model/router with `tools` and `structured_outputs`, explicit zero prompt/completion prices, and zero for every additional reported pricing field. Missing, blank, negative or nonzero prices fail closed.
- A free router or `:free` selection forces the free safeguards even if stale legacy environment flags say paid use is allowed. Every configured fallback must also satisfy the free preflight.
- Requests set zero prompt/completion/request/image price ceilings, strict schema output, `require_parameters:true`, `data_collection:"deny"`, and `allow_fallbacks:false`. If no endpoint can meet those requirements, Reach uses its local fallback instead of relaxing them. OpenRouter's documented free router may choose another compatible free model internally; it does not authorize a paid fallback.
- Router responses must name an actual model that the catalog identifies as eligible and free. Unknown, paid or router-alias response models are rejected. Fixed free-model responses naming an unexpected model receive the same validation. Output must also pass the local Zod schema.
- Reported `usage.cost` must be numeric zero when present. Positive, negative, string or otherwise invalid values fail closed; missing/null means **unknown billing metadata**, not evidence of a zero bill. Rejecting an anomalous response cannot reverse a provider charge already reported; the zero-price request constraints and free-only route are the preventive controls.
- The historical explicitly paid adapters are retained as separate deliberate configurations. They are not selected by this setup. A free/default OpenRouter request cannot activate Gemini merely because another key or old paid switches exist. Use the native explicit provider configuration only if intentionally leaving this free profile; it is outside the no-inference-charge setup described here.

OpenRouter documents free routing and free variants, but availability, compatible privacy/capability combinations and account quotas can change. There is no claim of unlimited requests, guaranteed model quality, account-specific billing verification, or free hosting/email/routing infrastructure. See [official research and sources](FREE-OPENROUTER-RESEARCH.md).

## Reliability and privacy

The existing shared client retains an eight-second deadline, cancellation, at most two inference attempts, bounded response bodies and rate/circuit controls. Every inference attempt consumes quota; a long server `Retry-After` stops locally. Invalid output/authentication/configuration does not trigger paid fallback. Free-model exhaustion returns an unavailable state.

Only the public model catalog is cached, for at most 60 seconds per fetch boundary. Prompts, completions, credentials, private replies and locations are not cached. Each inference still enforces zero-price routing limits and validates its own output. The cache expiry tests ensure later requests re-fetch metadata.

The existing default process-local limits are 128 reserved attempts/day, 20/minute globally, and 32/day plus five/minute per feature; configured limits and circuit breaking may reduce them. These do not coordinate multiple server processes or establish the user's OpenRouter account quota. Keep provider account limits in place. Larger deployments need shared limits.

Selected coordinates go to the deterministic route planner, not to AI interpretation. User text is bounded and treated as untrusted; do not submit sensitive information. Models propose allowed preferences or evidence IDs rather than pantry hours, stock, coordinates or schedules. The real database and existing route engine remain authoritative. A modeled pantry trip never proves current food stock or eligibility.

Email assistance still generates an editable draft only. Enrollment, sign-in, verified account checks, recipient/message review, renewed authorization after edits, queue dispatch and signed inbound reply handling are unchanged. No real email is sent by a draft or assistant request. The existing channel boundary remains available for a separately authorized future phone integration.

## Validation and current limitation

See [independent verification](FREE-OPENROUTER-VERIFICATION.md). Workflow tests use a mocked free completion with the actual pantry database and planner to confirm that no fabricated route/availability enters results; separate draft tests verify the free router and keyless editable template fallback. Browser provider/route responses are explicitly synthetic.

The first baseline run inherited the cloud's canonical app origin and produced 40 origin-fixture failures. Resetting only test-process canonical-origin defaults restored all 504 baseline tests; individual tests still set and verify their required origins. Production origin validation was not changed. There is no dedicated lint script; changed files use the existing formatter, plus TypeScript, data checks, unit tests, browser checks and a production build.

The original credential-free run had no usable key and left data-policy acknowledgement false. A later [supplied-credential follow-up](FREE-OPENROUTER-VERIFICATION.md#follow-up-supplied-credentials-october-24-2026-utc) authenticated the account and exercised the real free router and preference interpreter. That dated result does not configure a fresh checkout, guarantee capacity, or verify other integrations. Each installation still needs its own private key and deliberate data-policy acknowledgement. Do not label fixture tests as live inference.
