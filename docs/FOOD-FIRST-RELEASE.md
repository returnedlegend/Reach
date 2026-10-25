# Food first: implementation and candid release assessment

October 24, 2026 (America/Chicago). Work starts at `0f0878b` on `improve/food-first-experience`. This is an implementation report, not a public deployment or field validation. It supersedes older home-screen walkthroughs.

## The problem and actual changes

The old home screen hid results behind a four-step questionnaire. Literal search required every word to occur in a name/address: “I need food in Bryan” could return nothing despite existing Bryan records. Location and travel choices blocked browsing. AI was a separate dialog with another location gate.

The home screen now displays three maintained pantry options immediately. A short request or city shortcut narrows the list and focuses the results. There is no required account, location permission, eligibility intake, or destination questionnaire. Unknown geography gets a coverage explanation and explicitly separate alternatives. Negated cities are excluded. Grocery pantries are not presented as prepared-meal services or shelter. Detailed trip settings remain available by choice.

Adding an actual starting point starts a bounded trip check through the existing deterministic engine. The server restricts candidates to the search matches and checks retrieved routes, distribution/registration windows, walking limits, fare, transfers, appointments, and an explicitly requested return. The quick check leaves now; a future departure gets a clarification instead of silently becoming today. Fractional walking distances are preserved. An unclear return deadline is not approved as a one-way trip.

The assumptions are disclosed: one mile/20 minutes walking across the trip, $5 fare budget, two transfers, a 30-minute visit, and a 15-minute arrival buffer unless the request specifies supported limits. These are planning assumptions, not facts about the person. Appointment, eligibility, food stock, pedestrian pickup and step-free access remain unknown unless supported by evidence. The [ranking methodology](PANTRY-RECOMMENDATION.md) remains deterministic and bounded; no global optimum or stock probability is promised.

A selected check displays reasons and confirmation requirements. The map receives the exact checked outbound and return paths/instructions, without replacing them with an unrelated route-only request. Checks expire after a minute or a passed scheduled departure. Manual rechecking uses current time without background provider polling. Returning from the map preserves the request. An external Google Maps link calculates a separate route using the selected coordinates.

Existing bookmarks, saved trips, consent-based origin inclusion, text downloads and printing remain. Mobile scrolling and blob lifetime were repaired after an export interaction failed in the browser. Root startup now uses the supported standalone server rather than `next start`, copies only public/build assets, and preserves the project-relative database path. The primary screen is more compact, dark by default, and keeps sources/requirements in readable disclosures.

## AI and provider truth

AI is optional interpretation, not a condition for displaying pantries. With the existing release/configuration gates enabled, a user may opt into sending their short request to the provider. Selected coordinates are excluded from interpretation requests. Existing sensitive-text checks, strict schemas, free-model checks, bounded attempts and request budgets remain. Model-authored resource facts, eligibility, stock, coordinates and prose cannot populate the directory or override the factual recommendation. Turning AI off cancels a pending interpretation.

A synthetic public request through the new handler fell back to directory matching. A diagnostic attempt retrieved the OpenRouter catalog (HTTP 200), but completion requests returned HTTP 429 and 404. **No new successful live inference is claimed.** The fallback accurately says an attempted request may have reached the AI provider. [Sanitized evidence](evidence/food-first-live-ai.json) distinguishes this from fixture tests. “AI does 90%” is an aspiration, not a measured capability or a promise of free capacity.

Production still defaults to anonymous `core`. Optional AI needs the reviewed `extended` profile, `REACH_RELEASE_AI=true`, provider configuration and policy acknowledgement. Accounts, email and community are not silently enabled. No keys were added to client code or changed in private files. See [AI setup](DEEPSEEK.md), [release gates](FIRST-RELEASE.md), and [OpenStreetMap setup](OPENSTREETMAP.md).

## Feature inventory

| Area                   | Actual state                                                                                       | Material limit                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Discovery              | Repaired; immediate local results and request-aware search                                         | Selected central Texas sites, not a complete directory                                                              |
| Recommendations        | Simple entry to retained arrival/intake/return feasibility engine                                  | Real routes require an approved production endpoint; comparison is bounded                                          |
| Map and location       | Retained MapLibre/OSM, synchronized selection, GPS/manual/address/map inputs and text alternatives | Real-device GPS, safe walking entrances and live provider uptime are not established by fixtures                    |
| Save/download/print    | Retained and browser-regression checked                                                            | Storage can be blocked; no offline routing/map download                                                             |
| AI                     | New bounded interpretation and usable fallback                                                     | Live completion failed in this pass; configured does not mean available                                             |
| Email/authentication   | Existing secure workflows retained and independently reviewed; gated public scope                  | Live SMTP delivery and final-origin human OAuth login remain unverified; no mail sent                        |
| Pantry data            | 24 maintained records, 21 confirmed-site classifications, three unresolved                         | No organization contacted; stock, many requirements and 18 pedestrian policies remain unknown                       |
| Transit                | Static BTD Route 00 and missed-bus logic retained                                                  | GTFS/published timetable conflicts, narrow coverage, no live vehicle feed; Bryan ISD is restricted school transport |
| Community/volunteering | Retained behind operator gates                                                                     | Not part of anonymous core; moderation/partner operations not established                                           |
| Language/offline       | English UI and downloadable text retained                                                          | Full Spanish UI, installable PWA, service worker and offline routing are not implemented; deliberately deferred     |
| Hosting                | Existing single-host publishing kit and build retained                                             | No public host/domain selected, no deployment performed                                                             |

Unresolved records remain Bedias (address conflict), Grimes mobile distribution (event gate/access), and Madison mobile distribution (event location/recurrence conflict). No records were promoted based on proximity. No new organization verification is claimed. See [data evidence](RELEASE-DATA.md), [data/performance audit](CORE-DATA-PERFORMANCE.md), [map audit](CORE-MAP-AUDIT.md), and [backend audit](CORE-BACKEND-AUDIT.md).

## Engineering and verification

The existing Next.js 16/React 19/TypeScript/SQLite application remains. No dependency was added. Main changes:

- `simple-food.ts`: directory interpretation, negative travel/city handling, exact-point external links.
- `food-trip.ts`: supported limits, disclosed defaults, return clarification and short-lived trip checks.
- `food-search-service.ts` and `/api/food-search`: bounded optional AI interpretation.
- `food-plan-service.ts` and `/api/food-search/plan`: server-scoped delegation to the retained access engine without AI inference.
- `access-service.ts`: optional internal pantry-ID scope; clients cannot create resource facts.
- `simple-food-finder.tsx` and CSS: mobile entry, automatic trip checks, actionable cards and useful failures.
- `guided-reach.tsx`: exact itinerary handoff, request preservation and export repair.
- `location-picker.tsx`: optional compact address disclosure using existing logic.
- Startup script, root scrolling/icon, test helpers and CI: supported production launch and regression protection.

Baseline was 578 unit tests in 69 files. The updated standard `npm run check` passes data validation (24 production / six separate demo records), TypeScript, **638 unit tests in 73 files**, and the production build. An initial invocation incorrectly forced `core` across optional-feature unit fixtures and failed at the intentional gates. The corrected standard invocation passed; no production gate or assertion was weakened. [Current verification](FOOD-FIRST-VERIFICATION.md) records browser counts, build/runtime checks, security and performance conditions.

A Luna high reviewer independently reproduced the initial friction and checked location denial, manual selection, saving and accessibility. An Astra ultra reviewer held the trip integration for fractional distances, lost return/future intent, expiry, hidden requirements, transit labels, negated cities and itinerary handoff. Those defects, including a newly received result appearing prematurely expired, were fixed and rechecked. The final reviewed gate passed within that scope. Other Luna high audits covered map behavior, data/performance, backend consent/authentication and supported startup. No compute-cost savings are invented.

## Release decision and assessment

This is a stronger online directory/planning candidate. The full transportation/AI/email product remains **conditional**, not “everything works.” Publishing even a slim directory needs operator hosting, data-maintenance ownership and visible coverage limits. Production integrated routing needs an approved endpoint. Optional email needs authoritative DNS control and successful sender verification. The current read-only metadata/DNS recheck again shows `reachemail.com` authentication failed and Afternic delegation; no DNS was changed. See [the new provider observation](evidence/food-first-provider-status.json). See [current DNS verification and required records](FOOD-FIRST-DNS.md), [provider blockers](RELEASE-PROVIDERS.md) and [publishing](PUBLISHING.md).

Editorial assessment: **69/100**, not an impact benchmark. Functionality 17/25, reliability 12/20, UX 11/15, innovation 11/15, accessibility/social utility 7/10, security/maintainability 8/10, performance 3/5. Deductions reflect blocked production providers, narrow/uncertain data, no service-user or screen-reader field study, no deployed system, and limited performance/device evidence. Passing tests do not fill these gaps.

## Honest demonstration and genuinely remaining actions

A two-minute demonstration can show immediate options; “food in Bryan”; denied location with manual recovery; actual-point Maps links; a separately labeled synthetic intake/return comparison; exact checked instructions on the map; saved download/print; and an outage with useful options still visible. Do not represent fixtures as real trips or a test print invocation as a physical printer test.

Still required: choose host/domain/operator; configure and exercise production routing; resolve uncertain pantry/transit facts; configure and verify the chosen SMTP sender and relay if email is enabled; regain suitable free AI capacity if AI is enabled; test intended real devices, screen readers and service-user tasks. Contest eligibility, significant student contribution, truthful AI disclosure, conflicting deadlines and a compliant 1–3 minute public video remain entrant-owned. [Competition notes](CHALLENGE-REQUIREMENTS-2026.md) and [submission preparation](SUBMISSION-PREPARATION.md) remain applicable. Nothing was deployed, sent to an organization, or merged to `main` by this pass.
