# Reach SMTP and conversational assistant

Updated October 22, 2026 (America/Chicago). Reach keeps its Next.js/React, persistent SQLite accounts, MapLibre/OSM maps and deterministic food-access planner. No public deployment was made.

## Find the assistant

On the home page, choose **Reach AI assistant**. It is also available from the map tab before selecting a pantry, from the selected pantry, and from pantry details. A pantry detail's **Ask about availability** opens the existing private inquiry controls. The assistant uses the same selected coordinates and public pantry IDs as the map; **Show on map** selects that actual pantry and carries over the chosen mode, retrieved path/instructions and assessment warnings. It never replaces the origin with a city center. Cards keep a separately labeled Google Maps route-calculation link available even when Reach cannot retrieve a route; that external link is not evidence of a retrieved itinerary.

Ask about food, bus/walking/driving access or a selected pantry. Location is optional for a contact question; route requests need an explicitly selected origin. Permission denial has manual address/coordinate/pin alternatives. User-submitted text may be interpreted by the configured AI service, but origin/return coordinates and private pickup details are excluded from inference. Do not include identifying information in free text. Questions and answers stay only in component memory; closing the assistant clears them.

The assistant reads actual maintained pantry records through the existing planner. Hard failures, opening/registration cutoffs, walking/fare/transfer limits and calendar/Chicago-time checks remain deterministic. Optional AI can propose bounded preferences or highlight generated evidence IDs; it cannot author a departure, food stock, eligibility, coordinates or a valid itinerary. A missing service or route remains unavailable. An evening without an exact departure time prompts a follow-up (the explicit departure-time control also supplies that answer); a return deadline is not misread as a departure. The existing **Find food I can reach** flow supports explicit return points and deadlines.

Default assumptions are visible: public transit, today and the selected Chicago departure time, 20 minutes/1 mile total walking, $5 travel fare, two transfers, 30 minutes at pickup and a 15-minute arrival buffer, waiting allowed, unknown appointment and unconfirmed eligibility. These are editable through the existing detailed food-access flow; they are not proof of eligibility or availability. Shelter/prepared-meal coverage gaps and incomplete BTD coverage remain explicit.

## Local setup

Use Node 24 and run `npm ci` in the project directory, then `npm run dev`. Next loads `.env.local`; standalone workers require explicitly loading it. The existing root `.env.local` was preserved and extended with missing placeholders, is ignored by Git and mode 0600. Do not overwrite it with `.env.example` if it already contains settings. The source download excludes that private file; on a new installation copy `.env.example` to `.env.local` before editing.

### SMTP and pantry inquiries

Configure your mail service's relay, private credentials, authorized sender and TLS settings using [SMTP setup](SMTP.md). Choose `REACH_EMAIL_PROVIDER=preview` for private local captures or explicitly select `smtp` for real delivery. Keep `REACH_APP_ORIGIN` and the private SQLite database consistent across app and workers.

Run `NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch` for local worker polling; use production mode, the release email gate and a canonical HTTPS origin when hosting. `--once` performs one bounded dispatch.

Pantry inquiries require enrolled, consenting contacts, a verified account and explicit reviewed authorization. Live SMTP inquiries also require `REACH_OUTREACH_REPLY_EMAIL`, a monitored app-controlled mailbox. Operators receive replies in that mailbox; automatic inbound import and provider delivery webhooks are unavailable. Existing saved reply review remains private and does not establish public inventory. SMTP acceptance is distinct from inbox delivery.

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

Remaining operator actions: verified sending domain and sender, private SMTP credentials, outbound SMTP TCP permission, canonical app origin and worker process, a monitored reply mailbox for inquiries, source-backed enrolled pantry contacts, and an explicitly authorized test recipient before a live delivery test. Configure DeepSeek spending controls separately from Reach's process-local request budgets. For higher traffic, move process-local AI limits to a shared store and review provider capacity and transit/data coverage; no new deployment is required for local preview use.
