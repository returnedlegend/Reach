# Reach feature and usability audit — October 25, 2026

## Verdict

Reach is useful as an anonymous food directory with moderated community submissions. It is **not yet verified as a fully connected public release**. Live Groq generation, outgoing email, address lookup, and production pedestrian routing remain blocked or unsuccessful in this environment. A map displaying correctly is not proof that directions or food availability are verified.

The audit combined source/route inventory, actual Chromium interaction at 390×844 and 1280×900, screenshot inspection, keyboard interaction, accessibility scans, real local API requests, isolated database workflows, and automated regressions. “Manually reviewed” here means inspected rendered pages and observed flows, not that every state of every component was manually exercised. Provider fixtures are explicitly distinguished from live calls. Retired account-based components and unconfigured external-service success paths were not marked passed. No public deployment, real user records, real provider contact or outgoing email was involved.

## Defects corrected

| Finding | Impact | Correction |
|---|---|---|
| Home showed three expanded mathematical breakdowns before any search, duplicating the pantry cards | Severe mobile reading/scrolling burden; technical labels resembled a form rather than help | Comparisons appear after a request, collapsed behind “Compare your top …”; formulas are a second disclosure. Pantry cards and AI quick take remain directly usable. |
| Comparison directions ignored an explicitly rejected travel mode | Could invite a user who cannot walk into walking directions | Comparison buttons now honor the same blocked-mode guard as pantry cards. |
| Loading copy still described slow local computers and a two-minute wait | Misleading after Groq migration | Provider-neutral copy explains that map and results remain available. Spinner stays in the action button; skeletons remain nonblocking. |
| Privacy page said AI was disabled in the core release and advertised removed account flows | Inaccurate disclosure and dead-end instructions | Rewritten around anonymous discovery, hosted AI, local saves, submissions, moderation and actual retention limits; older services are labeled historical. |
| Extended/development flags advertised volunteer/account workflows despite removed public accounts | Links could send people to `/account`, which redirects to `/share` | Public feature flags no longer advertise Google, email-account or volunteer workflows. Direct legacy pages clearly state unavailable instead of rendering account-required forms. Admin review and sharing alerts are separate and retained. No backend access checks were weakened. |
| Anonymous visitors could open a password-change form they could not use | Confusing and inconsistent with protected admin pages | Server-side session and moderator checks now redirect visitors to admin sign-in. API authorization remains intact. |
| Pulling new code left old laptop `REACH_AI_PROVIDER=ollama` untouched | Users could still call a stopped local model after the Groq migration | Added explicit `npm run ai:setup`: preserves keys/unrelated values, selects Groq, adds absent placeholders, restricts file permissions, and leaves new policy consent false. A real key is still required. |
| Tests retained old wording and left approved synthetic offers behind | False failures and later test contamination | Updated assertions to current behavior and cleaned sharing fixtures. Additional approved listings are allowed rather than incorrectly assuming exactly three total cards. |
| Transit API fallback referred users to an unspecified timetable | Suggested unsupported integration remained usable | Fallback now points to external Google Maps transit directions and service confirmation. No schedule fabricated. |

## Route-by-route review

Every page route was visited in a mobile browser, including redirects and missing-page handling. The recorded pass means it rendered without observed page exceptions/horizontal overflow; it is not a claim that a remote dependency succeeded. 18 initial and 18 production route visits each reported zero axe WCAG A/AA violations in the sampled state. This does not replace assistive-technology/user testing.

| Route | Observed result and limit |
|---|---|
| `/` | Immediate real directory, search, failure messages, optional AI, top-three comparison, bookmarks, Map/Community/Saved navigation. AI success display tested with fixtures; live generation blocked. |
| `/share` | Both hotspot and extra-food forms accept anonymous submissions. Public coordinates, timing, consents, private email and optional food photo exercised. Records remain unpublished until approval. |
| `/food-hotspots` | Community listing/filter interface renders approved items. New-post entry points visible. Empty states remain useful. |
| `/food-hotspots?type=offer` | Household food offers render with approximate area and chosen public contact; private email excluded. |
| `/admin` | Fresh browser redirects to sign-in; authenticated moderator sees requests/photos and can approve. Anonymous API and photo access return 401. |
| `/admin/sign-in` | Actual password login exercised using synthetic temporary moderator in isolated SQLite. No Google sign-in. |
| `/admin/change-password` | Temporary-password flow, successful change, session invalidation and new-password login exercised; anonymous redirect verified. |
| `/account` | Redirects to sharing; no public registration. |
| `/pantries/[id]` | Real pantry address, schedule, unknown eligibility/access facts, contact/source links and local save render. Correction workflow checked separately. Missing/invalid IDs are covered by server tests. |
| `/pantry-planner` | Retained advanced legacy planner and explicitly fictional demo. Keyboard navigation, saving, export and print invocation tested in demo, not a real transit journey. Real scheduled-trip readiness remains limited by known data gaps. |
| `/privacy`, `/terms` | Readable pages, accessible links. Privacy updated to current behavior; legal text is not legal certification. |
| `/manage`, `/volunteer`, `/outreach` | Explicit unavailable pages for retired public account workflows. Existing modules remain in source; not advertised as operational public services. |
| `/unsubscribe`, `/outreach/unsubscribe` | Missing-token states render without exposing private data. Live emailed-token round trips not exercised. |
| unmatched route | 404 with recovery navigation. |

## Component coverage

This covers the component inventory, grouped by reachable workflow. Shared CSS/UI primitives are covered through rendered pages, not standalone assertions for every CSS rule.

| Components | Evidence / disposition |
|---|---|
| `guided-reach`, `simple-food-finder`, `ui` | Home/search/empty results, basic and advanced views, top-three display, device saves and error handling exercised; advanced transit success not claimed. |
| `ai-loading-indicator`, `loading-state` | Inline spinner, skeletons, duplicate prevention, stop/retry, reduced-motion checks. |
| `location-picker`, `pickup-location-fields` | Manual coordinates, explicit address submit, permission denial, timeout/stale-position handling, follow start/stop and corrections. GPS events/geocoder success mocked; no device GPS accuracy claim. |
| `journey-map`, `osm-map-canvas` | Real MapLibre rendering, cluster/pin keyboard selection, origin drag confirmation, route geometry/legend clearing, tile failure/retry, reverse lookup and coordinate consistency. Test cartography/routes use fixtures; separate real OpenFreeMap rendering observed. |
| `pantry-detail`, `busy-times` | Real pantry UI, schedule/unknown fields and contact details inspected. Source freshness remains separate from live stock. Crowd algorithms/API protections covered by unit tests; no real crowd dataset inferred. |
| `share-food-form`, `admin-submissions`, `admin-credentials` | Actual anonymous submission → private review → authorized photo retrieval → approval → public listing, plus real local password lifecycle with synthetic users. Both mobile and desktop. |
| `community-panel` | Anonymous browsing, posted food, approved-only visibility, public/private contact separation. Older account coordination subflows are not public-release claims. |
| `site-navigation`, `theme-toggle` | Main/mobile navigation, More menu keyboard/Escape handling, persistent dark/light selection, blocked storage and OS theme changes. |
| `reach-app` | Legacy planner/demo saved card, download and print; no assertion of usable real BTD itineraries. |
| `access-planner`, `navigation-guidance`, `navigation-preferences`, `reach-assistant` | Retained advanced code and deterministic/service contracts covered by unit suites. Unconfigured live AI/routing success is blocked. These are not a substitute for the simpler primary journey; not every advanced dialog state was manually tested. |
| `account-panel`, `google-sign-in`, `notification-preferences`, `outreach-panel`, `volunteer-panel`, `pantry-management` | Retained legacy code; current public entry points disabled. No claim that these removed account-based experiences work for anonymous visitors. |
| `release-unavailable` | Now used consistently at retired route entry points; clear return to Find food. |

## External-service findings

- **Live map:** OpenFreeMap-derived basemap rendered in a real browser with visible OSM/OpenMapTiles attribution. This verifies a map load, not provider uptime or pedestrian safety.
- **Geocoding:** an actual lookup of the public Bridge Ministries address returned HTTP 503, “Address search could not connect.” Manual coordinates, landmarks and location permissions remain alternatives. A successful address match is not verified here.
- **Walking routes:** actual `/api/journey` returned HTTP 503 because demonstration routing is not enabled in production. Configure a supported production routing endpoint per OPENSTREETMAP.md; do not silently enable an unrestricted demo server. Google Maps links calculate externally.
- **Transit/missed bus:** actual request returned unavailable. No live departures, stop accessibility, bus shelters or real usable round trip verified. Historical schedule logic remains unit tested; do not present it as live.
- **Groq:** server status correctly reports missing credentials. Fixture inference tests prove request/validation/fallback contracts, not live model quality or free quota. The operator must configure their account key and data-policy acceptance.
- **Email:** no live delivery performed. Isolated tests disabled external sending. Submission approval does not establish that reachpantrysupport@gmail.com received an alert. SMTP and worker configuration remain required; account sign-in is not required to submit food.
- **Data:** validation recognizes 29 maintained production pantries and six separate fictional demo pantries. This audit did not independently re-contact every organization or reverify every entrance/hours record. Closed days, eligibility, stock, safe access and uncertain coordinates remain separate facts; existing gaps remain gaps.

## Usability assessment

The anonymous discovery and sharing paths are substantially more coherent than the legacy mix. Large touch controls, dark mode, meaningful empty/error states and map/list alternatives are strengths. The largest fixed problem was the expanded technical comparison before results. Detailed formulas are still available for transparency, but people should not need them to choose a next action.

Remaining release-quality concerns: actual address search and walking directions must work reliably on the deployment; AI must be tested with the real model against representative requests and slow networks; moderator alerts need delivery monitoring; maintained data needs a named review owner and recurring review schedule. The lengthy optional advanced planner still requires more cognitive effort than the main food search. Test with people who use food assistance, including screen-reader users, before calling the app universally accessible. Automated axe passes alone cannot establish that.

## Operator actions

1. Pull the task branch, then run `npm run ai:setup` on the computer actually running Reach. It updates that computer's local config; GitHub never supplies private `.env.local` values.
2. Add a real `GROQ_API_KEY` locally, review the policy and set acceptance, restart Reach, then run `npm run ai:check -- --generate`. Do not paste keys in chat. Free-plan quotas/billing are controlled by Groq.
3. Resolve geocoder connectivity and choose a production-capable walking/driving router. Keep unverified routing explicitly unavailable until a real response succeeds.
4. Configure SMTP/alerts workers and authorize a controlled email recipient before testing delivery. Verify provider acceptance and inbox receipt separately.
5. Configure the real public HTTPS origin and provision the moderator on that deployment. Local test accounts and databases are never shipped.

## Verification totals

Final commands and counts are recorded below after the final rerun. Raw sanitized route and service observations are in `docs/evidence/release-audit-2026-10-25/`. Earlier failures from changed wording and test-data pollution are not hidden: they were corrected and rerun; blocked live checks remain blocked.

Final results:

- `npm run check`: **739 unit tests / 87 files passed**, TypeScript passed, data validation passed (29 production / 6 separate demo pantries), optimized production build passed.
- Clean-database production HTTPS browser pass: **80 passed**, no skipped checks, covering discovery, Groq failure/synthetic summary states, loading, GPS/follow, maps, sharing/moderation/photo privacy, admin passwords, navigation and theme.
- Separate browser checks: **2 passed** for anonymous pantry correction and device saving; **2 passed** for keyboard navigation, demo trip saving/download and print invocation. **84 browser checks passed in total**; printing verifies invocation/content, not a physical printer.
- Mobile route sweep: 18 production visits, no observed client exceptions, no horizontal overflow, no axe violations in sampled states. Inventory includes 29 TSX components; scope/blocked component states are listed above.
- `npm run ai:setup` exercised locally; `npm run ai:check` still correctly reports the missing Groq key. `.env.local` is Git-ignored and mode 0600; no credentials added to tracked files.
- Live provider observations remain as listed above. No live Groq response, SMTP delivery, successful geocoding, or production pedestrian itinerary was verified.

Visual evidence: [mobile home](evidence/release-audit-2026-10-25/home-mobile.png), [mobile map](evidence/release-audit-2026-10-25/map-mobile.png). API/route observation JSON records the audit environment, not the user's laptop. Test accounts, images, records and TLS certificates stayed in isolated temporary storage and are not shipped.
