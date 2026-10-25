# Reach SMTP and conversational assistant

Updated October 22, 2026 (America/Chicago). Reach keeps its Next.js/React, persistent SQLite accounts, MapLibre/OSM maps and deterministic food-access planner. No public deployment was made.

## Find the assistant

On the home page, choose **Reach AI assistant**. It is also available from the map tab before selecting a pantry, from the selected pantry, and from pantry details. A pantry detail's **Ask about availability** opens the existing private inquiry controls. The assistant uses the same selected coordinates and public pantry IDs as the map; **Show on map** selects that actual pantry and carries over the chosen mode, retrieved path/instructions and assessment warnings. It never replaces the origin with a city center. Cards keep a separately labeled Google Maps route-calculation link available even when Reach cannot retrieve a route; that external link is not evidence of a retrieved itinerary.

Ask about food, bus/walking/driving access or a selected pantry. Location is optional for a contact question; route requests need an explicitly selected origin. Permission denial has manual address/coordinate/pin alternatives. User-submitted text may be interpreted by the configured AI service, but origin/return coordinates and private pickup details are excluded from inference. Do not include identifying information in free text. Questions and answers stay only in component memory; closing the assistant clears them.

The assistant reads actual maintained pantry records through the existing planner. Hard failures, opening/registration cutoffs, walking/fare/transfer limits and calendar/Chicago-time checks remain deterministic. Optional AI can propose bounded preferences or highlight generated evidence IDs; it cannot author a departure, food stock, eligibility, coordinates or a valid itinerary. A missing service or route remains unavailable. An evening without an exact departure time prompts a follow-up (the explicit departure-time control also supplies that answer); a return deadline is not misread as a departure. The existing **Find food I can reach** flow supports explicit return points and deadlines.

Default assumptions are visible: public transit, today and the selected Chicago departure time, 20 minutes/1 mile total walking, $5 travel fare, two transfers, 30 minutes at pickup and a 15-minute arrival buffer, waiting allowed, unknown appointment and unconfirmed eligibility. These are editable through the existing detailed food-access flow; they are not proof of eligibility or availability. Shelter/prepared-meal coverage gaps and incomplete BTD coverage remain explicit.

## Local setup

Use Node 24 and run `npm ci` in the project directory, then `npm run dev`. Next loads `.env.local`; standalone workers require explicitly loading it. The existing root `.env.local` was preserved and extended with missing placeholders, is ignored by Git and mode 0600. Do not overwrite it with `.env.example` if it already contains settings. The source download excludes that private file; on a new installation copy `.env.example` to `.env.local` before editing.

### Resend SMTP

1. In Resend, add a sending domain you control and publish the DNS records shown in its dashboard. Wait until the domain is verified. Use a sender on that verified domain; an arbitrary `From` address will not establish authorization. Review [domain setup](https://resend.com/docs/dashboard/domains/introduction) and the current [SMTP guide](https://resend.com/docs/send-with-smtp).
2. Create an appropriate sending API key. Paste it privately into **`SMTP_PASSWORD` in the project-root `.env.local`**, never into chat, source code or browser variables. Use the exact SMTP username `resend`.
3. Configure the sender and transport:

```dotenv
REACH_EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=Reach
```

Fill the two blank credential/sender fields. Port 465 uses implicit TLS. To use 587, change both `SMTP_PORT=587` and `SMTP_SECURE=false`; Reach then requires STARTTLS before authentication. Certificate verification remains enabled. Other hosts/ports are rejected. The runtime must permit outbound TCP to this host/port: this managed environment currently has no SMTP TCP grant. HTTP proxy access alone does not establish SMTP access; do not bypass its network policy.

4. Set `REACH_APP_ORIGIN` to the exact app origin (for example, `http://localhost:3000` locally, or your canonical HTTPS origin in production). Restart the app after changes.
5. Start the existing worker with the same private database, origin and environment:

```bash
# Development; sends only after you explicitly enable smtp above.
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch
```

For a production host use `NODE_ENV=production`, HTTPS and a private persistent database volume. Do not use the development preview provider in production. `--once` performs one bounded dispatch. The central delivery service also handles existing account verification/recovery/notification templates; it preserves HTML/text branding and rate limits.

6. For pantry inquiries, enroll a source-backed organization contact using the existing reviewed/consented administration workflow described in [ACCESS-PLANNER.md](ACCESS-PLANNER.md). No real contacts are seeded. Review/edit the message, check **I reviewed the recipient and message and authorize this email**, then **Authorize and queue**. The worker rechecks enrollment, contact changes, permission, limits and authorization expiry before sending. AI cannot authorize it. No user location is added to the email.

### Replies and delivery status

SMTP does not receive email. Inquiries require the separate existing Resend receiving integration before authorization/dispatch:

- `REACH_OUTREACH_REPLY_DOMAIN`: app-controlled receiving subdomain with the provider's receiving MX records.
- `RESEND_INBOUND_API_KEY`: key with permission to retrieve received messages.
- `RESEND_INBOUND_WEBHOOK_SECRET`: signing secret for the inbound event endpoint.
- Configure the signed `email.received` event at `/api/outreach/inbound` on a reachable HTTPS app. See [ACCESS-INTEGRATIONS.md](ACCESS-INTEGRATIONS.md) and [RESEND.md](RESEND.md).

Replies are matched using opaque per-thread reply addresses, signature/replay protections and requesting-account ownership. They appear in **Private message history** and must be reviewed before their dated facts become private planner inputs. The sender and food availability remain unverified; public pantry records are not overwritten. Use Refresh to check for new replies/status. Receiving is not established by a successful SMTP send.

SMTP `accepted` means the relay accepted the message, not inbox delivery. Stable RFC `Message-ID` and the documented `Resend-Idempotency-Key` help preserve identity; only the provider's documented idempotency behavior establishes provider deduplication. An ambiguous socket/DATA result is `uncertain` and is not blindly retried. Explicit temporary refusals have bounded retries, and the entire send has a 20-second deadline. Application rate limits and worker leases also protect against duplicate/unsolicited sends.

Resend's SMTP guide does not specify a stable opaque provider response-ID grammar. This adapter stores the RFC ID separately and does not invent an `email_id`; SMTP deliveries therefore stay accepted/uncertain unless another reliable event establishes more. The existing signed delivery webhook at `/api/email/webhook` tracks Resend HTTP-API deliveries by their actual opaque IDs; it does not falsely mark an unmatched SMTP send delivered. Receiving/reply association still works independently of that delivery-event limitation.

### DeepSeek AI

Reach's active AI provider is DeepSeek. It uses paid API models and sends eligible user-submitted text to the provider. Review model pricing, provider terms and data handling before enabling inference. Full configuration, model behavior, privacy and retry details are in [DeepSeek AI setup](DEEPSEEK.md).

Configure the server-only variables in the project-root `.env.local` or secure production settings:

```dotenv
REACH_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=12000
REACH_AI_DATA_POLICY_ACCEPTED=false
```

Set the API key privately, review the provider's applicable data policy, then set `REACH_AI_DATA_POLICY_ACCEPTED=true` to acknowledge that choice. AI is not enabled by key presence alone. DeepSeek has no automatic cross-provider fallback. Request budgets do not cap dollar charges; configure spending controls in the provider account.

## Verification and remaining setup

See [independent verification](SMTP-AI-VERIFICATION.md) for observed browser/API results and [file manifest](SMTP-AI-FILES.md) for changed files. Automated SMTP tests use Nodemailer transport fakes and actual worker/delivery/database boundaries; browser model/route fixtures are labeled synthetic. No real email, authenticated AI completion or inbound provider callback was exercised for this task. The public model catalog was retrieved successfully.

Remaining operator actions: verified sending domain and sender, private API/SMTP credentials, outbound SMTP TCP permission, canonical app origin and worker process, receiving subdomain/keys/webhook for inquiries, source-backed enrolled pantry contacts, and an explicitly authorized test recipient before a live delivery test. Configure DeepSeek spending controls separately from Reach's process-local request budgets. For higher traffic, move process-local AI limits to a shared store and review provider capacity and transit/data coverage; no new deployment is required for local preview use.
