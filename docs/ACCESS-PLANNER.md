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

Use the browser's exact origin and port. Private POST endpoints require a matching Origin header; production requires a configured canonical HTTPS origin. Use one persistent SQLite host for the app and worker. Routing is disabled in a fresh example until deliberately configured; set an identifying `OSM_USER_AGENT` and follow [routing terms and opt-in](OPENSTREETMAP.md). The community Valhalla demo is low-volume, rate-limited and has no production SLA. Useful listings, source links, manual coordinates and external directions remain available without a routing service.

Run both notification and outreach queues with the same database and environment:

## Optional AI

AI interprets preferences into a strict allowlist, drafts a constrained inquiry, and extracts facts from untrusted reply text. It never calculates transit times or edits sources. Proposed preferences require **Apply**. Explanations of results are deterministic and grounded in their structured itinerary; no LLM explanation can introduce an unsupported fact.

AI remains unavailable until DeepSeek is configured with a server-side key and the operator accepts the applicable data policy. Current model names, setup, paid pricing, privacy boundaries and request limits are documented in [DeepSeek AI setup](DEEPSEEK.md). Reach validates AI output locally and keeps deterministic planning available when inference is disabled or unavailable. It does not automatically switch to another provider. Do not submit personal or sensitive text.

Ranking weights can be supplied as strict JSON in `REACH_ACCESS_WEIGHTS`; accepted keys and defaults are `travelMinute:1`, `walkingMinute:2`, `dollar:4`, `transfer:8`, `uncertainty:12`, `closingSlackMinute:0.1`, each 0–100. Smaller scores rank earlier **within** the fit/confirmation/failure class. Unknown fares receive an uncertainty penalty, never a zero-fare assumption. Scores are implementation details, not probabilities.

## Reviewed outreach and private replies

A verified existing account can contact only enrolled recipients. No production contacts are seeded, no household email is scraped, and a public email address alone is not participation consent. A local administrator can enroll a verified consenting organization with:

```sh
node --env-file=.env.local --import tsx scripts/outreach-admin.ts PANTRY_ID ORGANIZATION_EMAIL OFFICIAL_SOURCE_URL --verified-and-consented
```

This command records an administrator's attestation; it does not independently verify consent or send mail. Household donors enroll their own approved unexpired offer using their verified account email. They can stop inquiries. Recipient review displays the verified public organization contact; household addresses are masked.

The queue and message history are SQLite-backed. Worker summaries contain counts only. Completed inquiries are deleted after 30 days when an enabled worker runs; event deduplication records after seven days. Preview files need separate cleanup. Private endpoints are authenticated/owner-scoped and no-store. The existing metadata-only notification queue remains separate from the private inquiry bodies/replies. See [privacy notice](../src/app/privacy/page.tsx).

Existing saved replies retain requesting-account ownership, review and expiry checks. They remain unverified sender reports; user confirmation never guarantees food at arrival. No message can execute a tool, publish pantry edits or authorize another email.

Only the requesting account sees its reviewed report. Household routes additionally require an accepted pickup, both sharing consents, a currently approved unexpired offer, no block/suppression, and explicitly user-confirmed pickup coordinates. An approximate city marker is never used as a pickup point. Private arrangements do not enter the public directory.

## Future voice boundary

`OutreachChannel` separates delivery from generation, authorization and extraction. Email is implemented; there are no telephony dependencies or pretend call controls. A future voice adapter needs separate consent, recipient preferences, disclosure/recording rules, cost controls and verification before activation.

## Verification and limits
