# Reach first public release candidate

The [food-first follow-up](FOOD-FIRST-RELEASE.md) and [current verification](FOOD-FIRST-VERIFICATION.md) supersede this report's home-screen walkthrough and test totals. Its deployment/data evidence below remains scoped to its original run.

Assessed October 24, 2026. This is an implemented, locally tested release candidate, not a public deployment. The previous [CEO assessment](REACH-CEO-READINESS-REPORT.md) is historical; current evidence is linked below. The repository was on `main` with that assessment's changes uncommitted. They were preserved. The 30-second video at `/workspace/artifacts/reach-demo/Reach-30-second-demo.mp4` was inspected (30 seconds, H.264, 1920×1080); its older light UI is reference footage, not evidence of this release.

## Release boundary

Production defaults to `REACH_RELEASE_PROFILE=core`. It offers anonymous location selection, maintained pantry discovery, source/requirement information, deterministic comparison, provider-backed directions when configured, external navigation, device-local saving, text download and printing. Dark is the first-visit default; an explicitly saved light preference wins.

Accounts, Google identity, email, community/hotspots, volunteering and AI are independently gated. The server passes non-sensitive availability flags into navigation and panels. Hidden controls are backed by handler/provider guards: direct optional requests do not bypass the release profile, and previously valid account cookies do not restore private permissions in core. Unsubscribe paths can still disable prior subscriptions. Public directory details remain available.

For a separately reviewed feature, select `extended`, complete its checks, set only its `REACH_RELEASE_<FEATURE>=true` production attestation, and supply the existing feature configuration. The switches are operator attestations, not proof that a provider test succeeded. See [publishing gates](PUBLISHING.md). No optional feature was publicly enabled during this task.

## Implemented changes

- Corrected outbound/return chronology validation: a lookup result cannot depart before the requested start or before the pantry visit finishes. Invalid or reversed journey times cannot become a successful round trip.
- Preserved feasibility-first recommendation, candidate identity, true selected coordinates, unknown-fare handling, return requirements and meaningful alternatives. Routing-call exhaustion now emits a human-readable budget notice in addition to incomplete comparison metadata.
- Added prominent pedestrian-pickup uncertainty and excluded explicit no-pedestrian pickup from walking/transit discovery. Unknown permission stays conditional rather than becoming verified access.
- Added source freshness based on the oldest recorded source date, with a 30-day review cadence. Missing/future/invalid dates remain unknown; one newly checked source does not silently renew all facts. This cadence is a maintenance reminder, not a guarantee that facts stay correct for 30 days.
- Rechecked the three flagged pantry records and BTD sources. Maintained migration 2 refreshes only untouched active version-1 imports; manager-edited and archived records are preserved. Updated history is recorded and migration application is idempotent. These data updates do not resolve their location/access conflicts.
- Added anonymous private correction reporting with strict bounded input, same-origin checks, persistent global/site rate limits, duplicate suppression and 90-day retention. Reports never edit public facts and do not promise a response.
- Made standalone pantry saving available on the device without an account and synchronized saves from the embedded detail modal into the Saved tab without a reload. A browser regression reproduced the stale-tab defect and independently rechecked the fix. Saved/exported/printed information includes creation time, published requirements, sources/check dates and stale-snapshot warnings. Precise origins remain opt-in; saved files do not provide offline routing or live updates. Requested-but-missing returns remain explicitly unavailable in itinerary exports.
- Added deployment preflight for canonical HTTPS/domain, mounted private storage, real write/fsync capability, production provider choices, public Nominatim policy opt-in and identifying requests. Known volatile mounts are rejected. Demonstration routing is rejected in production at both startup and the actual routing boundary.
- Kept optional workers behind their release gates. Hardened image exclusions for environment files, keys, private databases, backups and local credential/editor directories. Unexpected crowd API failures no longer log raw error objects. Caddy operational errors now omit the structured request field; current configuration validation and a real isolated upstream-failure test confirmed that synthetic OAuth query markers were absent.

## Current readiness

## Verification and evidence

Use [release verification evidence](evidence/release-verification.json), [independent review](RELEASE-VERIFICATION.md), [data evidence](RELEASE-DATA.md), [provider observations](evidence/release-providers.json), [live route check](evidence/release-live-routing.json), [browser/map/axe observations](evidence/release-visual.json), and [container operations](evidence/release-operations.json).

Fixture tests use explicitly synthetic records, calendars and provider responses; they establish logic behavior, not actual food availability. Local production-browser tests used the exact canonical HTTPS test origin with a local certificate and a disposable database; they are not public-origin tests. External map assets were fetched through normal trusted Node HTTPS while only the local browser test certificate was excepted. The routing observation deliberately used preview-only Valhalla/FOSSGIS, a public BTD terminal example, and no personal account, email or AI inference.

The managed Docker VFS disk filled during repeated candidate builds. Tests initially failed to create their output directory, and extra container copies failed. Only task-owned images/cache/test resources were removed; source/private configuration were preserved. Browser output was directed to `/tmp`. This uncovered the empty-probe flaw, corrected to a 4 KiB write plus fsync. That detects an already-full volume at startup, not future disk exhaustion; disk monitoring and backup retention remain operator responsibilities. Read the dated operation evidence for final image and recovery results.

## Data maintenance procedure

No staff member is assigned or claimed. Before public launch, an owner must accept correction review and stale-data monitoring responsibilities. Run `npm run data:review` against the same private persistent database. It lists IDs, source-review deadlines, pickup uncertainty and pending correction counts without printing correction descriptions. Inspect private reports only in the authorized local database; never publish it or put descriptions into public logs.

Prioritize changed intake windows, closure reports, location conflicts and on-foot access. Check the official organization/directory and record source URLs/check dates for each supported fact. Ask the precise questions in [the data review](RELEASE-DATA.md) only after authorization to contact an organization. Do not infer policy from silence or replace a source conflict with a guess. Use authorized management with an explicitly reviewed extended profile, or a reviewed maintained-data migration; suggestions never auto-approve themselves.

Run `npm run data:prune` at least daily with the production database/env loaded. It removes expired anonymous corrections as well as expired crowd data. Reports also expire during subsequent submissions. A changed source should not be presented as a physical verification. Maintain registration, distribution, office, appointment, stock and pedestrian-access facts separately. Back up before changes and retain an auditable history.

## Smallest external actions

Competition preparation remains separate. No registration, public video upload, eligibility certification, or new claim of student authorship was made. Historical submission materials must not be mistaken for a completed public-service launch.
