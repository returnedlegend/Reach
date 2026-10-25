# Core data and browser audit — October 24, 2026

This read-only audit checked the maintained directory, provenance markers, initial page requests, and offline/PWA support. It does not re-verify providers or measure a production deployment.

## Maintained directory

`src/data/resources.ts` exposes 24 maintained food-assistance resources backed by `src/data/real-pantries.ts` and `src/data/pantry-verification.ts`. The current inventory has 21 `confirmed-site` records and three `needs-confirmation` records: Bedias Food Pantry, Grimes Mobile Pantry, and Madison Mobile Pantry. All 24 have coordinates and dated sources; 21 have structured windows. Eighteen leave pedestrian pickup unknown. Nineteen carry `detailsNeedConfirmation`, so a confirmed site still does not imply verified hours, eligibility, pickup access, stock, or a surveyed entrance.

The records have unique IDs, names, and normalized addresses in this snapshot. `npm run data:validate` passed for 24 maintained records and six fictional demo records; the focused data, maintained-review, and TX-10 data suites passed (9 tests). These checks establish structural consistency, not provider truth or de-duplication against every regional directory.

The three explicit location/schedule caveats remain material: Bedias has a 3202/3203 Main Street mismatch; the Grimes County Expo point does not identify an event gate or service line; and Madison's flyer dates conflict with its fourth-Thursday recurring description. For all three, the source publishes drive-through service but does not establish service for someone arriving on foot. The retained Route 00 GTFS snapshot also conflicts with BTD's public route table/PDF. See [the dated public release data review](RELEASE-DATA.md) for source detail. No provider contact or field inspection was performed in this audit.

`docs/evidence/readiness-metrics.json` records source dates only through October 22, while the current resource sources include checks dated October 24. Refresh that derived evidence file the next time the release metrics are regenerated; its other counts matched the current data snapshot.

## Initial browser load

I opened `http://127.0.0.1:3101/` in headless Chromium (`/usr/bin/chromium`) at a 390 × 844 viewport against the already-running **Next.js development server**. The page returned 200, reached `DOMContentLoaded` at about 416 ms, `load` at about 1,053 ms, and network idle at about 1,219 ms. The initial document transferred 21.6 KB. Playwright recorded ten requests (document, two CSS files, and seven JavaScript chunks) and no API routes; Chromium's performance entries also included a 9-byte favicon. The page's network-idle DOM had 283 elements.

Development assets were large: `main-app.js` transferred about 3.12 MB (13.45 MB decoded), and `app/page.js` about 422 KB (1.86 MB decoded). CSS transferred about 50 KB. These numbers include development runtime/source-map overhead and localhost timing; they are diagnostic observations, not production bundle sizes, Core Web Vitals, or user-network performance. No production build was run for this audit.

The homepage server component loads the directory and passes it into `GuidedReach`, a client component that statically imports the feature surface. The initial browser request did not call a route API, but the large development page chunk indicates there is value in checking the production client boundary before release. The smallest review step is to measure the production route chunks after a build; only split a feature such as advanced planning or map code if the production bundle confirms it is included in the initial route and materially large. Next.js documents route code-splitting as the default and recommends lazy loading client components where appropriate ([lazy-loading guide](https://nextjs.org/docs/app/guides/lazy-loading), [production checklist](https://nextjs.org/docs/app/guides/production-checklist)).

## Offline and release state

No web app manifest, service worker registration, offline page, or offline cache was found under `src/app` or `public`. Offline access is therefore not implemented; users need a network connection for the directory, map tiles, and provider-backed search/routing. This agrees with the [feature readiness audit](FEATURE-READINESS-2026-10-24.md), which classifies offline use as unsupported. Avoid PWA/offline claims until install metadata and an explicit offline behavior are added and checked.

The development environment status snapshot reported provider runtime variables as `unknown`, which does not establish credential readiness. This audit did not invoke external APIs. Current release guidance remains an online-required, partial TX-10 directory and trip-planning prototype; public deployment, live AI/OAuth/email, complete local coverage, live transit arrivals, guaranteed availability, accessible route safety, and offline use remain unestablished or unsupported. See [feature readiness](FEATURE-READINESS-2026-10-24.md) for the broader implemented-versus-blocked inventory.

## Integration follow-up

The older metrics file remains a dated snapshot. The coordinator created [a current derived data inventory](evidence/food-first-data.json), including October 24 source-check dates, and [production visual/performance observations](evidence/food-first-visual-performance.json). Those checks are separate from this development-server audit and do not establish new organization or field verification.
