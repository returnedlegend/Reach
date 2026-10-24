# Food I can reach: planner and private availability inquiries

Implemented 2026-10-22 in the existing Reach application. Start with **Find food I can reach** on the home page. The existing Explore, Map, account, Community, saved trips, downloads and print flows remain available.

## Decisions and boundaries

The deterministic engine owns journey feasibility and ranking. It evaluates routed walking legs, published transit calendars, arrival/intake windows, appointment status, visit duration, optional waiting, fare/transfer/walking limits, mobility and dietary uncertainty, and an optional return journey. All transit clocks use America/Chicago and service-day minutes; 24:00–47:59 represent an explicitly requested following day. Ambiguous clock-change journeys are unavailable rather than falsely precise. A current-day search cannot board a bus that has already left.

Results are **Meets stated constraints**, **Needs confirmation**, or **Does not meet a known requirement**. Missing hours, eligibility, accessible paths, fares, inventory or return data never become positive facts. Availability must remain fresh at expected service time, not merely when searched. A sender report can expire during travel. Published windows distinguish registration/intake from distribution. A visit estimate is user-selected, not a live queue measurement. No success probability is displayed.

Straight-line distance shortlists candidates only. The default search checks routes for three nearby confirmed sites (`REACH_ACCESS_CANDIDATES`, maximum five), retaining other results as unexamined. **Check this route** explicitly evaluates another selected destination. Each search permits at most 12 walking-adapter lookups and stops launching work after 25 seconds. Existing provider timeouts and aggregate rate limits apply; a complete round trip or transit connector may exhaust this budget and remain unconfirmed. More comprehensive regional transit needs reviewed feeds and a production routing deployment, not additional inferred routes.

The existing MapLibre/OpenStreetMap stack supplies paths and textual alternatives. Walking geometry and estimates come from Valhalla; the existing published-timetable engine supplies bus legs, official stop IDs and GTFS shape segments. Direct BTD general-public one-way fare is $1 per the official rates page checked October 22; transfer fares stay unknown and discounts are not presumed. The BTD GTFS/PDF conflict remains visible. Demand-response and restricted school transportation are not instant public buses. See [official integration research](ACCESS-INTEGRATIONS.md), [GTFS provenance](GTFS.md), and [OpenStreetMap configuration and policies](OPENSTREETMAP.md).

Current directory coverage is 24 maintained sites in Brazos County and a partial TX-10 pilot, with 21 confirmed distribution sites and three unresolved records. It is not nationwide coverage. No pantry record, pin, entrance, accessibility claim or service schedule was guessed or overwritten by this feature.

## Run locally

Use Node 24 (`nvm install` / `nvm use` with the included `.nvmrc`), then `npm ci` and `npm run dev`. On a fresh checkout, copy `.env.example` to `.env.local`; preserve an existing file. Next reads this file, standalone workers do not. Do not commit it. No Google credentials are required.

For local account/inquiry preview:

```dotenv
REACH_APP_ORIGIN=http://localhost:3000
REACH_EMAIL_PROVIDER=preview
REACH_EMAIL_PREVIEW_DIR=.local/mail-preview
REACH_AI_PROVIDER=disabled
```

Use the browser's exact origin and port. Private POST endpoints require a matching Origin header; production requires a configured canonical HTTPS origin. Use one persistent SQLite host for the app and worker. Routing is disabled in a fresh example until deliberately configured; set an identifying `OSM_USER_AGENT` and follow [routing terms and opt-in](OPENSTREETMAP.md). The community Valhalla demo is low-volume, rate-limited and has no production SLA. Useful listings, source links, manual coordinates and external directions remain available without a routing service.

Run both notification and outreach queues with the same database and environment:

```sh
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch
# One bounded outreach-only dispatch, if needed:
NODE_ENV=development node --env-file=.env.local --import tsx scripts/outreach-worker.ts --once
```

Preview writes private email captures and sends nothing. Never publish captures: account links and private messages may be present. Delete them after testing. Preview is prohibited in production. No fake receiving HTTP endpoint is exposed in development.

## Optional AI

AI interprets preferences into a strict allowlist, drafts a constrained inquiry, and extracts facts from untrusted reply text. It never calculates transit times or edits sources. Proposed preferences require **Apply**. Explanations of results are deterministic and grounded in their structured itinerary; no LLM explanation can introduce an unsupported fact.

All providers are disabled until explicitly selected, configured, and accepted by the operator. No account quota or model quality could be evaluated without an authorized account, so the safe default is the deterministic fallback rather than a claimed best model. Official documentation and public catalog checks are in [ACCESS-INTEGRATIONS.md](ACCESS-INTEGRATIONS.md).

```dotenv
REACH_AI_PROVIDER=openrouter
REACH_AI_MODEL=an-actually-listed-model:free
OPENROUTER_API_KEY=your_openrouter_api_key_here
REACH_AI_FREE_ONLY=true
REACH_AI_ALLOW_PAID=false
REACH_AI_DATA_POLICY_ACCEPTED=true
```

The model name above is an explanatory placeholder, not a usable identifier. Select a current model yourself after reviewing privacy and account quotas. OpenRouter free-only requires a `:free` identifier and zero prices in all catalog pricing fields. Provider routing denies data collection and fallback and requires parameter support; that combination may have no available free endpoint. There is no paid or cross-provider fallback. Gemini/Groq adapters require their respective server keys and explicit paid opt-in (`FREE_ONLY=false` **and** `ALLOW_PAID=true`): their account-specific billing cannot be proved free by a public catalog. Do not enable paid usage unless intended.

Requests have cancellation, an eight-second timeout, at most one bounded 429 retry that respects Retry-After (long waits fall back locally), strict output validation and a three-failure/60-second circuit breaker. Defaults are 128 logical AI tasks/day and 20/minute per process, with 32/day and 5/minute per feature. A task can include a public catalog check and one bounded retry; these are not a hard cap on network requests. Counters reset on process restart. Configure `REACH_AI_PREFERENCES_DAILY_LIMIT`, `REACH_AI_DRAFT_DAILY_LIMIT`, `REACH_AI_REPLY_DAILY_LIMIT` and corresponding `_MINUTE_LIMIT` values; zero disables a feature. These local safeguards do not establish provider quotas or distributed deployment limits. Invalid configuration fails closed. Text containing detected precise locations stays local, but heuristic filtering is not a guarantee: do not submit personal or sensitive text. No precise origins, account identifiers or private household names are needed for AI interpretation.

Ranking weights can be supplied as strict JSON in `REACH_ACCESS_WEIGHTS`; accepted keys and defaults are `travelMinute:1`, `walkingMinute:2`, `dollar:4`, `transfer:8`, `uncertainty:12`, `closingSlackMinute:0.1`, each 0–100. Smaller scores rank earlier **within** the fit/confirmation/failure class. Unknown fares receive an uncertainty penalty, never a zero-fare assumption. Scores are implementation details, not probabilities.

## Reviewed outreach and private replies

A verified existing account can contact only enrolled recipients. No production contacts are seeded, no household email is scraped, and a public email address alone is not participation consent. A local administrator can enroll a verified consenting organization with:

```sh
node --env-file=.env.local --import tsx scripts/outreach-admin.ts PANTRY_ID ORGANIZATION_EMAIL OFFICIAL_SOURCE_URL --verified-and-consented
```

This command records an administrator's attestation; it does not independently verify consent or send mail. Household donors enroll their own approved unexpired offer using their verified account email. They can stop inquiries. Recipient review displays the verified public organization contact; household addresses are masked.

Workflow: choose enrolled contact → editable template/optional AI draft → review recipient/message → explicit authorization → durable queue → worker → provider status → signed reply → user review → recalculate → accept the revised itinerary. Every message truthfully discloses the AI-assisted inquiry. Approval is bound to the enrolled contact fingerprint; a changed contact cancels queued mail. Initial approval expires after 24 hours. Recipient cooldown is at most one inquiry per day, with five authorized sends per user/day, bounded retries and delivery idempotency. Ambiguous transport outcomes are **uncertain**, not automatically resent. Optional follow-ups require separate consent, 24-hour minimum intervals, one or two messages, and a 24–72-hour expiry. Replies, suppression, cancellation and expired consent stop them. Pending authorization does not grant permission for arbitrary outreach.

The queue and message history are SQLite-backed. Worker summaries contain counts only. Completed inquiries are deleted after 30 days when an enabled worker runs; event deduplication records after seven days. Preview files need separate cleanup. Private endpoints are authenticated/owner-scoped and no-store. The existing metadata-only notification queue remains separate from the private inquiry bodies/replies. See [privacy notice](../src/app/privacy/page.tsx).

### Real Resend receiving setup

Keep preview until an authorized deployment/test recipient is available. Follow [Resend sending setup](RESEND.md), then configure a receiving domain (or Resend-managed receiving subdomain), its exact Resend-provided MX records, and these **server-only** values:

```dotenv
RESEND_INBOUND_API_KEY=your_receiving_capable_resend_api_key
RESEND_INBOUND_WEBHOOK_SECRET=whsec_endpoint_specific_secret
REACH_OUTREACH_REPLY_DOMAIN=replies.yourdomain.com
```

Subscribe a **separate** webhook at `https://YOUR_REACH_ORIGIN/api/outreach/inbound` to `email.received`. Its secret differs from the outbound delivery webhook's `RESEND_WEBHOOK_SECRET`. The inbound key needs permission to retrieve received emails (a send-only key is insufficient); if omitted, the existing Resend API key is used only if it has that permission. Apply domain-specific least privilege where supported. Do not use example values or expose keys through `NEXT_PUBLIC_`.

The handler verifies the exact raw Svix-signed body before retrieving plain-text email through the official SDK. It correlates an unpredictable app-controlled reply address and exact enrolled From mailbox, deduplicates events, strips quoted history for extraction and rejects unsupported output. The signature proves Resend delivered the webhook, **not human sender identity**. Sender identity remains unverified; facts are private and require user confirmation. HTML-only messages and attachments are not ingested. Ambiguous dates/times remain unknown. No message can execute a tool, publish pantry edits, or authorize new email. Confirmed reports expire within 48 hours and no later than their applicable date/window; they do not guarantee food at arrival.

Only the requesting account sees its reviewed report. Household routes additionally require an accepted pickup, both sharing consents, a currently approved unexpired offer, no block/suppression, and explicitly user-confirmed pickup coordinates. An approximate city marker is never used as a pickup point. Private arrangements do not enter the public directory.

## Future voice boundary

`OutreachChannel` separates delivery from generation, authorization and extraction. Email is implemented; there are no telephony dependencies or pretend call controls. A future voice adapter needs separate consent, recipient preferences, disclosure/recording rules, cost controls and verification before activation.

## Verification and limits

See [independent feature verification](ACCESS-VERIFICATION.md), [fixture evaluation](ACCESS-EVALUATION.md), and `npm run access:evaluate`. Unit fixtures are deliberately synthetic and never production data. External walking estimates do not establish safe pedestrian entrances, step-free access or current food inventory. No live AI inference, Resend delivery, receiving webhook or public deployment is claimed without a successful real check. Public source and routing checks are reported separately from fixture browser tests.
