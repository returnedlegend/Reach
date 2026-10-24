# How Reach works

Reach combines anonymous pantry discovery, maps, deterministic trip feasibility, optional AI interpretation, accounts, pantry management, and explicitly reviewed communication. The central scheduling question remains: can a visitor travel to a pantry, finish a visit during its operating window, and return before a deadline? That answer is computed from structured records, not invented by an AI model.

## Current application layers

| Layer | Main code | Responsibility |
| --- | --- | --- |
| Public presentation | `src/app/page.tsx`, `src/components/guided-reach.tsx` | Load the active public directory; collect an optional starting point; present resources, map, details, saved items and guided steps |
| Maintained directory | `src/lib/public-directory.ts`, `src/lib/pantry-store.ts` | Read active SQLite pantry records with schedules, provenance and uncertainty; report failures rather than silently reverting to stale seeds |
| Access planning | `src/lib/access-service.ts`, `access-engine.ts`, `access-routing.ts` | Retrieve supported itineraries, apply travel/timing/eligibility constraints and produce explainable results |
| Maps and provider boundaries | `journey-map.tsx`, `osm-map-canvas.tsx`, `src/lib/osm-services.ts` | Render MapLibre, validate provider data and support explicit location/routing requests with honest unavailable states |
| Optional AI | `src/lib/openrouter-client.ts`, `reach-assistant.ts`, navigation modules | Interpret bounded preferences and explain computed evidence without creating resource facts, routes, inventory or eligibility |
| Identity and authorization | `src/lib/community.ts`, `account.ts`, `account-store.ts` | Private SQLite identities and sessions; account verification and role/ownership checks |
| Reviewed communication | `src/lib/outreach.ts`, `outreach-worker.ts`, mail modules | Draft, authorize and dispatch eligible inquiries; preserve idempotency and distinguish preview, submission and delivery states |

The home directory currently contains 24 maintained food sites; dataset scope and individual verification status are described in [TX-10 data](TX10-DATA.md). The original bounded timetable planner remains at `/pantry-planner` and `POST /api/plan`. The sections below describe that retained engine; its supplied walking links must not be confused with separately configured street-routing providers used by the newer access planner.

## Trust boundaries

- Browser location is opt-in. A user's origin is not proof of a reviewed entrance or safe route. Saving a precise trip origin requires its own explicit choice.
- Public pantry facts come from the maintained directory. User observations, unreviewed corrections, private replies and AI output cannot silently become trusted inventory or eligibility data.
- Provider secrets remain server-side. `/api/ai/status` reports configuration without invoking a model. AI output is locally schema-validated and cannot change deterministic hard constraints by inventing data.
- Sensitive mutations require the supported origin/session/authorization checks. Production account/access/assistant workflows require a canonical HTTPS origin.
- An email draft is not authorization to send. Review approval is reset after message edits; workers recheck relevant authorization and contact conditions before dispatch.
- `GET /api/coverage` serves the repository's existing 119th Congress Census boundary and provenance, not an approximate or future district shape.

See [development and maintenance](DEVELOPMENT.md), [authentication](AUTHENTICATION.md), [pantry storage](PANTRY-DATABASE.md), and [SMTP/AI setup](SMTP-AI-SETUP.md) for configuration and operational details.

## Data flows through four parts

1. **Presentation:** the Next.js interface collects trip constraints and displays explanations and itinerary segments. Separate real and demo datasets prevent fictional records from appearing as verified local recommendations. Real results use the active maintained directory and expose missing walking links and source conflicts.
2. **Pantry schedules:** typed records describe recurring dates, opening and closing times, separate registration and distribution cutoffs, appointment requirements, source conflicts, and remaining unknowns.
3. **Transit provider:** `PublishedTimetableProvider` implements the `TransitProvider` interface in `src/lib/types.ts`. It finds journeys in a small supplied timetable.
4. **Feasibility evaluation:** the engine combines walks, outbound transit, a buffered pantry arrival, the configured visit duration, and the return journey. It returns `fits`, `confirm`, or `no`, with reasons and itinerary segments.

The interface calls the same engine through `POST /api/plan`, sending `{ demo: true, input: PlannerInput }` for fictional demonstration results. Real-data requests use `demo: false` and evaluate the reviewed production records; the route also guards against unavailable production coverage. Travel mode (`bus` or `walk`) is a separate planner input. API keys for future services must remain on the server.

## Time and recurrence

The local agency timezone is represented as `America/Chicago`. Times are minute offsets relative to a service date. The timetable parser accepts values beyond 24:00: for example, a 25:10 departure belongs to the prior service date and occurs at 01:10 the following calendar day. The provider considers previous-day service and its calendar exceptions. The separate GTFS importer preserves these service-day offsets.

Recurrence records support weekly weekdays, an ordinal weekday such as second Thursday, explicit dates, and the first N occurrences of a specified weekday, such as the first four Saturdays. A provider's recurrence must be represented accurately rather than approximated as weekly.

## Import and provenance

`python3 scripts/import-btd.py` reads the checked-in official ZIP, verifies structure and references, and generates a JSON projection plus provenance. Only 30 Orange trips and six selected stops are loaded. Feed validity is July 15, 2025 through December 31, 2026. Ten website-derived 2026 holiday closures overlay the empty original GTFS exceptions file. The official PDF/GTFS time conflict remains an explicit transit uncertainty; see [GTFS import](GTFS.md).

## Routing limits

The small router supports direct rides and at most one transfer at the same stop. Transfers obey the timetable's minimum transfer buffer. It does not search arbitrary transfers, walk between transfer stops, route over street geometry, or use live bus positions. A separate Python importer validates and projects a selected official GTFS snapshot into its timetable model. It only returns journeys within its declared timetable validity period.

Walking distances and minutes come from explicit origin-to-stop, pantry-to-stop, and direct origin-to-pantry connections. Their review status matters. No real pantry links have been reviewed; the engine exposes this gap rather than manufacturing routes. Three real origins represent exact bus stops, with no modeled home-to-stop access. Demo connections are fictional, even when their fixture review flags exercise a successful planning path.

## Honest uncertainty

A known timing conflict can rule out a trip. An unknown pickup policy or conflicting source must remain an uncertainty, not become proof of eligibility or ineligibility. A favorable computed result means the stated constraints fit the supplied data; it never guarantees food supply, short queues, admission, or an appointment.

## Persistence and maintenance

Saved trip snapshots use browser-local storage; plain-text trip-card download and printing provide portable copies. Individual removal and a clear-all control remove saved records; clearing browser site data also removes them. A downloaded file or printed card remains until its owner deletes or discards it. Saving is not booking, and no offline route computation is provided.

Separately, the application has a private SQLite account and pantry database. It stores identity/session state, account favorites and preferred locations, maintained pantry records, authorized manager changes, audit/history records, community data and private outreach state. Browser-local saves and account data are distinct persistence paths. Use the documented migration, private-volume and coherent backup/restore workflow; do not package live SQLite files or mail-preview captures with the source.

The public sources view cannot modify trusted information. Maintainers review version-controlled records and their import changes; assigned authorized managers can update maintained records through audited database workflows. Run validation and tests, inspect changes, and review provenance before publishing. Additional agencies should implement the provider interface only after their data and complete journeys have been verified.
