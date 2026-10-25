# Optional AI and inbound email integrations

Historical research checked 2026-10-22 against the linked official documentation. It is an integration decision note, not a live account or quota check. Its OpenRouter/Gemini/Groq comparison predates the current DeepSeek integration; use [DeepSeek AI setup](DEEPSEEK.md) for active configuration, pricing and privacy guidance. There are no configured Gemini, Groq, OpenRouter, or Resend credentials/accounts available for runtime validation. Existing Resend documentation covers outbound account and notification email in [RESEND.md](RESEND.md); this note covers inbound email research for the implemented optional workflow. The current transit and regional coverage audits remain in [GTFS.md](GTFS.md) and [TX10-DATA.md](TX10-DATA.md); consult those before changing route coverage or describing timetable confidence.

## Recommendation

Keep AI assistance explicitly opt-in and disabled by default. Set one provider and one model explicitly; never fail over from one hosted provider to another automatically. When the provider is disabled, unavailable, out of quota, or fails schema validation, return the existing deterministic application result and a clear unavailable state. Do not send account credentials, verification or recovery links, private messages, or unnecessary personal data to an inference provider.

Of the three providers reviewed, Gemini publishes a free tier with free input and output tokens for eligible models, but its eligible model set and per-project limits vary and the free tier permits content use to improve Google products. Groq's rate-limit page presents separate Free Plan and Developer Plan limit views, but does not give a stable public free-plan quota in the page text; its model catalog lists token prices. Verify the active plan, applicable pricing, and limits in the account before treating Groq as zero-cost. OpenRouter publishes free model endpoints with a small, shared API request allowance and a live catalog with model and endpoint pricing. A zero price in that catalog is useful for a runtime gate but cannot guarantee zero charges across a later routing or catalog change.

Do not represent any provider as a guaranteed-cost-free production dependency. For an explicit free-only mode, prefer a local deterministic path; optionally permit a hosted request only after a strict live pricing check and with the account configured so no paid fallback is allowed. Keep provider selection disabled until a maintainer deliberately configures a key, model, privacy policy, and deployment limits.

## Provider findings

| Provider          | Free inference evidence                                                                                                                                                                                                                                                                                                                                          | Structured JSON                                                                                                                                                                                                                                   | Limits and privacy that affect this project                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Gemini API | Pricing documentation identifies a free tier with free input and output tokens for eligible models. Some models are explicitly unavailable on the free tier.                                                                                                                                                                                                     | Native structured output accepts JSON Schema with `application/json`; it is available only for supported models and supports a subset of JSON Schema. Validate the returned object in Reach anyway.                                               | Limits are project- and tier-specific, vary by model, and can change. The active values are shown in AI Studio; documentation does not supply a single guaranteed quota for every account. Free-tier content may be used to improve Google products. Avoid sending sensitive or identifying user content on this tier.                                                                                    |
| GroqCloud         | The rate-limit documentation has separate Free Plan and Developer Plan limit views, while the public model catalog lists token prices. The static page text does not provide a stable free-plan quota or establish zero-charge billing for a particular account. Confirm plan, pricing and limits in the account before selecting it for a free-only deployment. | Chat completions support JSON Schema structured output on selected models. Strict mode requires all fields and `additionalProperties: false`; support is model-specific. Best-effort and JSON-object modes need application validation.           | Limits vary by organization and model and are exposed in the account Limits page and response headers. Groq says inference inputs and outputs are not retained by default, but may be temporarily retained up to 30 days for reliability or abuse monitoring unless the organization enables ZDR. This is a technical service statement; review the current terms and data controls before use.           |
| OpenRouter        | The live `/api/v1/models` catalog exposes model IDs and pricing; the FAQ says free models have a shared allowance of 50 API requests/day for accounts without purchased credits, or 1,000/day after at least $10 in credits. It describes free models as low-limit and generally unsuitable for production.                                                      | OpenAI-compatible `response_format: {type: "json_schema", ...}` is supported only on model endpoints that advertise `structured_outputs`. Support and enforcement vary by provider endpoint; use `require_parameters: true` and validate locally. | Provider logging and training practices differ. The provider policy filter and privacy settings can block routes according to data policy, but model provider behavior remains endpoint-specific. OpenRouter's FAQ says prompt/completion logging is off by default unless opted in, while the inference provider receives each request and has its own policy. Treat prompts as third-party disclosures. |

A free model listing or API key does not establish the account's present allowance, remaining quota, or sustained availability. No token or request quota is inferred here beyond the published OpenRouter FAQ values above. Recheck provider documentation and the actual account console before enabling a provider. Do not copy current quota numbers into runtime constants.

### Runtime zero-price gate

OpenRouter is the only reviewed service with a public model-catalog API that can support a direct runtime price check. Before a request, fetch `https://openrouter.ai/api/v1/models` and locate the exact configured model ID and endpoint variant. Require every applicable price field (input, output, cache, image/audio or other modality, and per-request charges when present) to parse as zero; require advertised `structured_outputs` capability if using JSON Schema. Reject missing, malformed, unknown, or nonzero price fields. Do not substitute `openrouter/free` as proof of a zero price: it is a router, and model/endpoint selection is dynamic. If using a selected provider endpoint, pin the model and provider and disable fallbacks where the API allows it. Reject on a failed or stale catalog lookup.

This check is a best-effort guard, not a billing guarantee: the catalog and routing can change between check and completion, and it cannot independently inspect account billing settings or reconcile a later invoice. Record the chosen model/provider and returned usage cost metadata without recording prompts. A strict no-charge requirement should keep hosted inference off unless the application can enforce a provider-side hard spend limit or use only deterministic local logic. Gemini and Groq documentation do not expose a public unauthenticated pricing/quota endpoint that proves an individual account will remain on a free allowance; do not claim otherwise.

The Gemini REST reference was additionally checked against the actual `generateContent` endpoint contract. It documents `GenerationConfig.responseFormat.text.schema` for JSON Schema and `mimeType` as the enum `APPLICATION_JSON`; the older `responseSchema` field is deprecated and uses a different schema subset. Provider adapter serialization is tested with mocks; no authenticated inference response has been observed.

## Suggested interface and failure behavior

Keep the application boundary narrow, for example:

```ts
type AssistanceConfig = {
  enabled: boolean; // false unless explicitly configured
  provider: "gemini" | "groq" | "openrouter";
  model: string; // required, pinned value; no implicit latest/auto routing
};

type AssistanceResult<T> =
  | { status: "available"; value: T; provider: string; model: string }
  | { status: "disabled" | "unavailable" | "invalid_output"; value: T };
```

The `value` on non-available results should come from deterministic application logic, not generated text. Require runtime schema validation even when a provider advertises strict JSON output. Set a short timeout and bounded retries for transient errors; do not retry authentication, policy, invalid-request, or quota failures. Do not call an LLM for route safety, eligibility, medical/legal advice, account authorization, or facts absent from reviewed source data.

## Resend inbound email contract

Resend can receive email on a Resend-managed `<id>.resend.app` subdomain or a verified custom domain with the required MX configuration. A configured `email.received` webhook is a signed `POST`; the event contains metadata, not the body or attachments. Its useful correlation fields include `data.email_id` (Resend's identifier), `data.message_id` (RFC Message-ID), `data.from`, `data.to`, `data.received_for`, and `data.subject`. `received_for` records the recipient address associated with forwarding. Retrieve content server-side only after signature verification:

```http
GET https://api.resend.com/emails/receiving/{email_id}
Authorization: Bearer <server-side Resend API key>
```

The Resend SDK equivalent is `resend.emails.receiving.get(email_id)`. The current REST reference says the retrieve response can include Resend-computed SPF/DKIM/DMARC `authentication` results for newer messages. However, the repository's pinned Resend Node SDK 6.34.1 `GetReceivingEmailResponseSuccess` type does not declare `authentication`; use the REST API if that field is needed, or verify its availability after an SDK upgrade. Do not cast it into existence. The webhook does not contain the original body, headers, or attachments. Resend supplies signed attachment URLs through the receiving attachment API; treat downloaded files as untrusted input.

Verify each webhook with the endpoint-specific Resend signing secret and the exact raw body plus `svix-id`, `svix-timestamp`, and `svix-signature` headers, using the Resend SDK or Svix library. Verify before parsing or acting on event data, and make event handling idempotent by webhook event ID. Validate event type and destination address, then persist the `email_id` and `message_id` with the internal thread/case record before asynchronous retrieval. Do not treat a valid webhook signature as proof that the sender is trusted: it only authenticates the webhook delivery from Resend. Even if a future SDK adds the API's `authentication` field, it must not promote sender identity to verified or remove manual review for account-sensitive actions.

For a reply in the original email thread, use the received email's `data.message_id` as the outgoing message's `In-Reply-To` header and prefix the subject with `Re:`. Email clients use the RFC `message_id` for threading; the Resend `email_id` is for retrieving the inbound message. Neither is an authorization credential. Match replies to an existing internal case using a random, unguessable case token or verified account workflow; do not infer account ownership from `From`, subject, display name, `To`, or a client-supplied `In-Reply-To`. Check Resend-computed authentication results where present, but SPF/DKIM/DMARC results are not user authentication and can be absent or inconclusive. Treat message content as hostile input and do not execute instructions embedded in mail.

The repository's current mail endpoint is for outbound delivery events, as documented in [RESEND.md](RESEND.md). The implemented inbound route is `/api/outreach/inbound` and requires separate receiving-domain, key and webhook configuration. Research alone does not enable or verify live receiving.

## BTD publication recheck

Checked 2026-10-22. The official GTFS source URL listed in [GTFS.md](GTFS.md), <https://www.btd.org/2025btdgtfs/>, currently redirects to <https://www.btd.org/wp-content/uploads/2025/01/2025BTDGTFS.zip>. That response was HTTP 200, 247,754 bytes, with `Last-Modified: Wed, 21 Oct 2026 15:21:44 GMT`. Its SHA-256 is `192d83d6a79b816a88a892566c82a3ead6d566671860e544722b883f67f21ace`.

The downloaded published archive differs from the checked-in `data/transit/btd-2026-10-15.zip` (247,771 bytes; SHA-256 `d2b7948582883f6c8191d613ea3c7f80f64db48e86a467057a69725538e4825b`). The downloaded archive's `feed_info.txt` says `Updated: Oct 28, 2025, 12:33 PM`; the checked-in feed is documented as `Updated: Mar 25, 2026, 2:20 PM`. Both declare July 15, 2025–December 31, 2026 coverage; the downloaded archive's `calendar_dates.txt` is empty. A normalized row comparison found `calendar.txt`, `calendar_dates.txt`, `trips.txt`, `stops.txt`, and `stop_times.txt` identical. Route 00 Orange still has 30 source trips and 120 selected-stop time rows; all selected stop IDs, times, trip IDs, service IDs, and the weekday calendar are unchanged. The six projected stops are identical. Its two `BryOrange` shape sequences (363 points total) are also unchanged. The only agency-level change is `agency_id` 60059 to 514; all 19 `routes.txt` rows change only to reference that agency ID. `shapes.txt` has one removed and 132 changed points, all on `CL-A-IB`, outside the projected Route 00 geometry. Thus the currently served archive changes network metadata and an unrelated route shape, but introduces no Route 00 timepoint or shape regression in the projection currently used by Reach.

This byte and metadata difference still needs editorial reconciliation: the current publisher URL serves a feed version older than the snapshot's documented March 2026 version. Do not infer an effective period from the HTTP `Last-Modified` header (October 21, 2026), silently substitute either archive, or alter production data. The official [BCS Fixed Route Map PDF](https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf) itself is dated November 2025; its HTTP `Last-Modified` is also October 21, 2026, which does not establish a timetable effective date. It continues to disagree with the retained Route 00 GTFS times, as recorded in the existing provenance. The current files reviewed do not establish which conflicting timetable is effective. Reconcile the publisher link, feed version, PDF and source evidence through the existing editorial import review before changing data. No production data was overwritten.

The official [Fixed Route Rates](https://www.btd.org/fixed-routes/rates/) page currently lists a $1.00 general-public one-way cash fare, $0.50 for children 6–12, free rides for children under 6 with a paying customer, and a free fare for Blinn/TAMU students and staff with a current school ID. It lists additional reduced fares for seniors with an S-Pass, disabled riders with a D-Pass, and Medicare-card holders. These are current provider statements; do not infer that a fare is automatically available without the required proof/card. The official [ADA Paratransit eligibility page](https://www.btd.org/paratransit/eligibility/) says anyone may ride fixed routes, but ADA paratransit eligibility requires qualifying disability-related inability to use fixed routes and an origin and destination within 3/4 mile; eligibility is determined by BTD. This is not an additional fixed-route eligibility restriction.

The official [Schedules & Maps by City page](https://www.btd.org/fixed-routes/schedules/) links to Bryan/College Station service information. The official [BCS Fixed Route Map PDF](https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf) currently returns HTTP 200 and `Last-Modified: Wed, 21 Oct 2026 15:21:44 GMT`. It continues to publish timetable values that conflict with the GTFS projection, as already documented in [GTFS.md](GTFS.md). The webpage offers the PDF as provider timetable information; neither its schedule nor the feed proves actual vehicle operation. Keep the conflict flagged for rider confirmation and do not overwrite the checked projection as part of this check.

## Official documentation reviewed

Provider documentation:

- Gemini pricing and free-tier/model eligibility: <https://ai.google.dev/gemini-api/docs/pricing>
- Gemini structured output: <https://ai.google.dev/gemini-api/docs/structured-output>
- Gemini REST GenerationConfig and ResponseFormatConfig: <https://ai.google.dev/api/generate-content>
- Gemini project and model rate limits: <https://ai.google.dev/gemini-api/docs/rate-limits>
- Gemini model lifecycle and model identifiers: <https://ai.google.dev/gemini-api/docs/models>
- Gemini data logging and datasets: <https://ai.google.dev/gemini-api/docs/logs-datasets>
- Groq supported models, published prices and catalog endpoint: <https://console.groq.com/docs/models>
- Groq organization rate limits: <https://console.groq.com/docs/rate-limits>
- Groq structured outputs and model support: <https://console.groq.com/docs/structured-outputs>
- Groq data retention and Zero Data Retention controls: <https://console.groq.com/docs/your-data>
- Groq privacy policy: <https://groq.com/privacy-policy>
- OpenRouter model catalog API: <https://openrouter.ai/api/v1/models>
- OpenRouter FAQ, free model quota and logging statements: <https://openrouter.ai/docs/faq>
- OpenRouter structured outputs and per-endpoint capability: <https://openrouter.ai/docs/guides/features/structured-outputs>
- OpenRouter provider logging and data policy filters: <https://openrouter.ai/docs/guides/privacy/provider-logging>
- OpenRouter routing and provider-selection controls: <https://openrouter.ai/docs/guides/routing/provider-selection>

Resend receiving and webhook documentation:

- Receiving overview and domain setup: <https://resend.com/docs/dashboard/receiving/introduction>
- Create a receiving webhook: <https://resend.com/docs/dashboard/receiving/create-receiving-webhook>
- `email.received` event payload: <https://resend.com/docs/webhooks/emails/received>
- Retrieve received email API: <https://resend.com/docs/api-reference/emails/retrieve-received-email>
- Retrieve received email content: <https://resend.com/docs/dashboard/receiving/get-email-content>
- Threading and reply correlation: <https://resend.com/docs/dashboard/receiving/reply-to-emails>
- Verify webhook signatures with Resend/Svix: <https://resend.com/docs/webhooks/verify-webhooks-requests>
- Current official BTD GTFS source URL: <https://www.btd.org/2025btdgtfs/> (currently redirects to the ZIP linked in the verification above)
- BTD fixed-route rates: <https://www.btd.org/fixed-routes/rates/>
- BTD ADA paratransit eligibility: <https://www.btd.org/paratransit/eligibility/>
- BTD schedules by city: <https://www.btd.org/fixed-routes/schedules/>
- BTD Bryan/College Station Fixed Route Map PDF: <https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf>
- Existing Reach outbound email setup: [RESEND.md](RESEND.md)

Transit and service area references:

- Reviewed BTD snapshot, calendar overlays, timetable discrepancy and routing assumptions: [GTFS.md](GTFS.md)
- TX-10 point-in-polygon methodology, accepted and excluded service candidates, unresolved schedule/location details: [TX10-DATA.md](TX10-DATA.md)
