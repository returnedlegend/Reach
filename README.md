# Reach

The latest work replaces the questionnaire-first home screen with immediate food options and a short request, then checks arrival/return feasibility from an optional selected location. Read the [food-first implementation and candid assessment](docs/FOOD-FIRST-RELEASE.md) and [verification evidence](docs/FOOD-FIRST-VERIFICATION.md). AI/routing failures keep pantry details and external directions usable; live provider capacity is not promised.

The latest implemented release boundary and evidence are in [First public release candidate](docs/FIRST-RELEASE.md). Production defaults to the anonymous core: optional account, Google identity, email, AI, community and volunteer services are gated in both UI and server. Public hosting and production routing remain explicit external setup steps.

## Current readiness assessment — October 24, 2026

Read the [executive feature-by-feature report](docs/REACH-CEO-READINESS-REPORT.md) for working behavior, external blockers and concrete repairs. This pass makes dark mode the first-visit default and integrates an [explainable pantry recommendation algorithm](docs/PANTRY-RECOMMENDATION.md) into **Find food I can reach**. It checks feasibility before score, preserves alternative tradeoffs, and labels incomplete searches. It does not guarantee food, eligibility or pedestrian access.

The [publishing kit](docs/PUBLISHING.md) was built and tested locally, including persistent storage and offline backup/restore. No public deployment was performed. See [current verification evidence](docs/evidence/readiness-verification.json), [official 2026 competition requirements](docs/CHALLENGE-REQUIREMENTS-2026.md), and [submission preparation](docs/SUBMISSION-PREPARATION.md). Official deadline sources conflict; prepare before the earlier published cutoff unless the organizer resolves it. The entry needs truthful AI/contributor disclosure and a 1–3 minute video.

## Documentation

Start with the [documentation index](docs/README.md). The [single-host publishing guide](docs/PUBLISHING.md) covers the Docker/Caddy deployment kit, private database operations and operator release gates; it does not claim a public deployment. The [development and maintenance guide](docs/DEVELOPMENT.md) covers Windows/POSIX setup, testing, layout conventions and troubleshooting. Use the [demonstration guide](docs/DEMO.md) for a real-directory walkthrough and the separately labeled fictional planner. The [architecture overview](docs/ARCHITECTURE.md) explains the current database, provider and authorization boundaries. The [code review report](docs/CODE-REVIEW.md) records the latest findings, fixes, validation and review limits.

The latest alignment pass centers the guided progress/form/community panels, balances tablet search, corrects empty-state SVG alignment and tidies the footer. See [before/after evidence and recorded checks](docs/FINAL-POLISH.md#follow-up-alignment-polish--october-23-2026). Dated live-provider observations are recorded separately in [OpenRouter verification](docs/FREE-OPENROUTER-VERIFICATION.md); they are not a guarantee of future availability or email delivery.

## Final polish and demo checks

The latest pass simplifies the home-to-pantry journey, restores the official district-boundary map toggle, hardens the retained planner API, makes travel-intent and email approval safer, and repairs Windows test/runtime portability. See [audit, changed files, verification, and demo steps](docs/FINAL-POLISH.md).

Use Node 24. For browser tests, install Chromium with `npx playwright install chromium` (or set `PLAYWRIGHT_CHROMIUM_PATH`). Unit GTFS reproduction also needs Python; set `REACH_PYTHON` to its executable if it is not on PATH. No separate lint command is configured; TypeScript, unit/data checks, production builds and changed-file formatting are checked.

Production account/access/assistant endpoints deliberately require a canonical HTTPS `REACH_APP_ORIGIN`; a plain HTTP production server without this setting is suitable only for basic discovery smoke checks, not end-to-end authenticated or assistant workflows. Do not bypass the origin guard to demonstrate those features. Live AI, search/routing, OAuth and mail still require their documented operator configuration. No live food availability or route is fabricated when a provider is unavailable.

Google account sign-in is available alongside Reach passwords. Configure the separate Google OAuth Web client using [Google sign-in setup](docs/GOOGLE-SIGN-IN.md). Only identity permissions are requested; pantry emails still use Reach’s configured SMTP service and explicit approval.

Reach is a mobile-first community-resource and transit website for Bryan–College Station, built with Next.js 16, React 19, TypeScript, and Node.js 24.

The guided flow lets people search for a food site by name, city, address, or ZIP code, review nearby options, and open **Get directions** into the in-app Trip directions sheet. Browser location is opt-in; manual locations remain available. Walking and driving can show provider route lines and turn instructions, and a separate comparison can check actual routes to up to five nearby confirmed sites. Following GPS can update the trip origin; **End route** clears the active directions. The map groups close markers when zoomed out; **Map view** and **Show directions/Hide directions** control the map and route panel. It uses MapLibre GL JS and a hosted OpenFreeMap style by default, with no Google key or map ID. Search and routing providers remain optional; public routing requires deliberate operator opt-in. See [OpenStreetMap setup](docs/OPENSTREETMAP.md) and [archived Google adapter notes](docs/GOOGLE-MAPS.md). The original pantry planner remains at `/pantry-planner`.

## Find food I can reach

The home page starts with immediate food options and a short request. For the retained detailed feasibility planner, choose **Step-by-step trip controls**, then **Find food I can reach**; it uses the existing map and real routing boundary. Set walking/fare/transfer limits, arrival or return deadlines, and optional mobility/dietary requirements. Results distinguish known failures from missing information, evaluate availability at arrival, and explain the actual itinerary. Optional AI preference interpretation is disabled by default; manual controls always work. **Check availability** opens reviewed inquiries to enrolled contacts with a verified account. Sending stays in private preview here; live sending requires SMTP and a monitored reply mailbox; new replies are handled manually. No production contacts or inventory are fabricated.

See [planner setup, limits and outreach](docs/ACCESS-PLANNER.md), [independent checks](docs/ACCESS-VERIFICATION.md), [official integration research](docs/ACCESS-INTEGRATIONS.md), and [fixture evaluation](docs/ACCESS-EVALUATION.md), and [changed files](docs/ACCESS-FILES.md). `npm run access:evaluate` compares synthetic scenarios to a proximity-only baseline. The mail worker now dispatches both consent-based notifications and separately authorized inquiries. Private inquiry history is retained separately from the metadata-only notification queue.

## Optional AI Navigation

Reach now defaults to local Llama 3.2; see [primary AI setup](docs/LLAMA.md). The following DeepSeek configuration is retained only for an explicit provider switch. The default models are `deepseek-flash` and `deepseek-v4-pro`; both are paid. The operator must configure a private API key and accept the applicable data policy before inference. See [DeepSeek setup, pricing, privacy and limits](docs/DEEPSEEK.md). Earlier [OpenRouter verification](docs/FREE-OPENROUTER-VERIFICATION.md) is dated historical evidence and does not describe current provider availability.

The existing food-access planner now has optional service, urgency, household-size, identification and transit preferences, plus routed driving alongside walking and scheduled BTD transit. A five-module pipeline keeps resource facts, feasibility and ranking deterministic. Optional DeepSeek models interpret submitted preferences and foreground computed guidance; every suggested preference needs review, and manual controls work without credentials. Prepared meals and shelter have an explicit coverage gap. Fuel, parking, stock, document rules and accessibility are never assumed. See [configuration, privacy and cost limits](docs/AI-NAVIGATION.md), [provider sources](docs/NAVIGATION-PROVIDERS.md) and [independent checks](docs/NAVIGATION-VERIFICATION.md). Dated live inference observations in [OpenRouter verification](docs/FREE-OPENROUTER-VERIFICATION.md) refer to the earlier provider setup; no public deployment is claimed.

## Conversational assistant and SMTP

The **Reach AI assistant** dialog is available from Map, Step-by-step trip controls, or pantry details when enabled. It uses the selected starting point, maintained pantry data and deterministic routing with the configured AI provider. **Ask about availability** opens editable inquiries for explicit approval. Existing SMTP delivery supports TLS, bounded sending and duplicate safeguards; private preview sends nothing externally. Replies go to a configured monitored mailbox. See [SMTP setup](docs/SMTP.md).

## Mobile design

The food search, map resource sheet, pantry details and supporting pages now share a mobile-first daisyUI 5 / Tailwind 4 design with deep teal and slate light/dark themes. See [the design system](docs/DAISY-DESIGN.md) and [independent checks and screenshots](docs/DAISY-VERIFICATION.md). Address search, precise coordinates, routing, accounts and saved itineraries keep their existing behavior. The [earlier redesign report](docs/UI-REDESIGN.md) is historical.

## Community and mobile experience

Explore, Map, Community and Saved share one selected starting point. GPS and local address matches recenter the map; map corrections require confirmation. Raw coordinates and research notes are inside optional disclosures. Pantry summaries and ranking use recorded schedules, Chicago time and explicitly labeled straight-line proximity; they never establish live food inventory or transit reachability.

Resource bookmarks stay on this device. Saving a guided trip can include an exact origin only after an explicit consent checkbox. The existing detailed planner, saved plans, text exports and printing remain available.

Community is a **development pilot, disabled by default in production** with persistent SQLite accounts, organizer approval, moderated hotspots and eligible food offers, pickup requests, one-reservation transactions, reporting, blocking, photos stripped of metadata and moderator takedown. No real listings or accounts are seeded. Public food-offer locations are approximate city areas, not residential coordinates or actual meeting-place recommendations.

To run the local pilot after installing dependencies:

```bash
npm run dev:community
```

Both development commands bind to loopback. Community is off by default with `npm run dev`; `npm run dev:community` explicitly enables it for that local process. Set `REACH_COMMUNITY_ENABLED=false` in `.env.local` to keep normal development disabled. The home-screen **Food hotspots** shortcut opens hotspot browsing without losing your starting point; `/food-hotspots` also opens the app directly in that view. Select **Create Food Hotspot**, sign in, and request organizer approval to post. Production `npm start` still requires explicit `REACH_COMMUNITY_ENABLED=true`. To moderate, provision a separate account using `npm run community:admin -- create-moderator USERNAME`, supplying its password privately through stdin or `REACH_COMMUNITY_ADMIN_PASSWORD`. Ordinary account registration cannot grant moderator rights. See [community setup and security](docs/COMMUNITY.md), [food-sharing policy and launch blockers](docs/FOOD-SHARING-SAFETY.md), and [independent feature verification](docs/FEATURE-VERIFICATION.md). Public deployment is not authorized or production-ready.

## Email accounts and pantry management

The existing SQLite store now also holds email accounts, private preferred locations, favorites, pantry details, recurring distribution windows, inventory, assigned managers, corrections and audit history. Maintained pantry records are imported idempotently with their IDs, sources and original verification dates preserved. Public results, map pins and the retained planner read active records from this database. Archived records remain available to authorized managers for restoration.

Open **Account** or `/account` for sign-in, registration, verification, password recovery and profile settings. Pantry cards and selected map results open full details, optional crowd reports and busy-times charts. `/manage` is restricted to assigned verified managers and administrators. Community organizer/moderator permissions remain separate. Anonymous discovery and trip planning still work.

Mail defaults to disabled. For private local preview, set `REACH_EMAIL_PROVIDER=preview` and `REACH_APP_ORIGIN=http://localhost:3000` in `.env.local`. Account links are captured in private `.local/mail-preview` files; nothing is sent. Production preview is disabled. Existing server-side SMTP requires a configured sender, TLS credentials, the canonical HTTPS origin and persistent storage. See [SMTP setup](docs/SMTP.md).

Optional pantry, volunteer and pickup email preferences start off. A durable metadata-only queue rechecks current consent and authorization before dispatch; essential account security messages remain separate. Run the notification worker alongside the app, using the same database and origin:

```bash
# Next loads .env.local; standalone tsx does not. Load it explicitly on Node 24:
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch
```

Use `--once` for a single bounded dispatch. Worker summaries contain counts, not recipients or message bodies. See [SMTP setup](docs/SMTP.md) for environment loading, private preview access and delivery limits. SMTP acceptance does not establish inbox delivery.

```bash
npm run data:migrate
# Schedule this maintenance command at least daily on the application host:
npm run data:prune
# After registering and verifying a real email account:
npm run account:admin -- administrator@example.org
```

Accounts extend the existing identity store with Argon2id and server-side SMTP. This is custom authentication and needs ongoing security maintenance. Read [authentication setup](docs/AUTHENTICATION.md), [SMTP setup](docs/SMTP.md) and [database backup/rollback](docs/PANTRY-DATABASE.md) before hosting.

Busy times use optional observations, never opening hours as traffic evidence. Historical bins require three reports on each of three separate local dates; each account may report once per pantry per local day. Missing or insufficient data stays empty. Recent community observations are not live occupancy or a promise of food. Inventory states show their source and update time. No crowd or inventory observations are seeded in production.

## Run

Use Node.js 24 (`.nvmrc`; `nvm install` then `nvm use` if using nvm).

```bash
npm ci
npm run dev
```

Use your host’s development-server access facilities. For production run `npm run build`, then `npm start`. For a fresh checkout, copy `.env.example` to `.env.local` when setting optional providers. If `.env.local` already exists, edit it in place and preserve its existing variables. The example keeps routing and email provider selection disabled; follow [OpenStreetMap setup](docs/OPENSTREETMAP.md) to deliberately opt into the community demo for a low-volume local prototype. Without search or routing providers, the site remains usable with manual coordinates, official source links, map display, and directions handoffs; it does not invent routes or distances.

## Data and routing limits

The current directory contains 24 food sites: the original eight Brazos County listings and 16 additions (12 Brazos and four regional). Twenty-one are classified as confirmed distribution sites; three still need confirmation for a Bedias address, the Grimes fairground gate, and Madison dates/gate. Published hours do not guarantee same-day food, eligibility, accessible entrances, safe pedestrian paths, or holiday operation. See [TX-10 data provenance and limits](docs/TX10-DATA.md) and [the boundary source](docs/TX10-BOUNDARY.md). The expansion and its prior live-provider evidence are documented in [independent TX-10 verification](docs/TX10-VERIFICATION.md). See [daisyUI verification](docs/DAISY-VERIFICATION.md) for the current interface and regression results.

BTD Route 00 Orange uses an official static GTFS snapshot valid through December 31, 2026, with published 2026 holiday closures. GTFS and official PDF timetable values conflict; affected scheduled options require confirmation. Static routing uses actual published stop coordinates and does not invent walking links from nearby points. A five-minute transfer margin is an application assumption, not a BTD guarantee. No live vehicle feed is connected.

The default map is a hosted OpenStreetMap-derived basemap. It needs no Google credentials, but depends on its provider's availability and terms. Public Nominatim search requires informed operator opt-in, a single-instance deployment, and an identifying User-Agent; it sends a user-entered search only after submission and does not autocomplete. Walking/driving routing remains off unless a Valhalla-compatible service is configured or the FOSSGIS community demo is explicitly selected. The community routing terms permit at most one request per second, require OSM attribution and an identifying User-Agent, and provide no availability guarantee. See [provider setup and limits](docs/OPENSTREETMAP.md).

Google Maps links are optional external handoffs, not an API integration. The unused legacy server adapter remains covered by mocked tests; setting old Google variables does not switch the migrated application back to Google. See [archived notes](docs/GOOGLE-MAPS.md).

## Validate

```bash
npm run check
npm run test:e2e
```

`check` validates maintained data, types, unit tests and production build. Browser tests cover the guided flow and retained pantry planner at phone, Android-sized, tablet and desktop viewports. These are Chromium emulations, not physical-device tests. Community cases require an explicitly enabled isolated test server and test moderator; otherwise they are skipped. Follow the complete setup in [feature verification](docs/FEATURE-VERIFICATION.md). They use `/usr/bin/chromium`; set `PLAYWRIGHT_CHROMIUM_PATH` if needed. `REACH_TEST_URL` targets an already-running server. `python3 scripts/import-btd.py` reproduces the checked-in projection from the official source ZIP.

See [OSM migration verification](docs/OSM-VERIFICATION.md), [independent verification](docs/VERIFICATION.md), [v3 verification](docs/VERIFICATION-V3.md), [GTFS import](docs/GTFS.md), [map and data audit](docs/OSM-DATA-AUDIT.md), and [source review](docs/DATA-SOURCES.md). Earlier architecture, demo, and evidence documents also describe the retained pantry planner.

Primary AI: [Run Llama 3.2 with Ollama](docs/LLAMA.md). The main food search uses Llama to compare and order matching pantry options by default. See [how pantry comparisons work](docs/AI-PANTRY-RANKING.md). Travel feasibility stays separate and computed; suggestions do not guarantee food availability.

Latest interface loading and email cleanup: [implementation, checks and remaining release limits](docs/UI-POLISH.md), with [independent review](docs/QUALITY-REVIEW.md).
