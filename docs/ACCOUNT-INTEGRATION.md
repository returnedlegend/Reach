# Account and pantry integration — October 19, 2026 (America/Chicago)

This update extends the existing Reach application; it does not deploy it. The implementation preserves MapLibre/OpenStreetMap, precise/manual location selection, static BTD trip planning, saved/downloaded/printed itineraries and the moderated community pilot.

## Architecture and migration

The existing Node 24 SQLite identity and community database is also the pantry/account store. Existing users, content ownership, eight reviewed pantry IDs, source links and verification dates are preserved. Imports are idempotent and do not overwrite edits or restore archived listings. New accounts use maintained Argon2id; legacy scrypt credentials upgrade after a valid login. Custom authentication remains an ongoing maintenance responsibility, rather than a claim of provider-managed security.

Public home, hotspot and planner routes now read active pantry records from the database. Database errors show an unavailable state instead of restoring stale seeds. Structured schedules and current source references drive summaries and planning. Changes to pickup coordinates or address quarantine old walking connections. Source identity remains stable across reordering; replacing a citation invalidates its old schedule reference.

Accounts support email verification/recovery, legacy email attachment with reauthentication, profiles, password changes, deletion, private consented locations and favorites. Account and community roles share identities but pantry administrator/assigned-manager permissions remain separate from community moderation. `/manage` uses server-side permissions, versioned writes, archive confirmation, restoration, inventory, schedule/source editing, correction review, assignments and audit history.

Pantry details are reachable from cards, map selections and `/pantries/[id]`. The guided detail dialog preserves the selected origin and returns focus to the journey. Busy times distinguish historical observations, recent community reports and insufficient evidence. No real crowd or inventory observations are seeded. Quieter suggestions require sufficient history and a supported future distribution window, including registration/distribution cutoffs and uncertainty checks.

## Checks actually run

| Check | Result |
| --- | --- |
| Pre-change `npm run check` | Passed: 184 tests, TypeScript, data validation, production build |
| Final `npm run check` | Passed: 251 tests across 20 files, TypeScript, data validation, production build |
| Maintained data validation | Passed: 6 separate fictional demo pantries and 8 production pantry records |
| Existing browser regressions | 188/188 passed on isolated production server, across 390px phone, 412px Android-sized, 820px tablet and 1280px desktop Chromium viewports |
| Final-build account/detail/management UI checks | 28/28 passed across those four viewports |
| Independent real account/management lifecycle | 2/2 passed on final production build, mobile and desktop; no mocked APIs |
| Production dependency advisory audit | `npm audit --omit=dev`: zero known vulnerabilities reported |
| New authentication/pantry/crowd source formatting | Prettier check passed |
| Crowd maintenance command | Executed successfully against isolated test DB; expired-row behavior covered by store tests |
| Real email delivery | Not configured: live SMTP credentials/relay and authorized sender not verified; not claimed as passed |

The production browser total is **218 passed** (188 regression + 28 feature checks + 2 independent account/management lifecycle checks). The independent lifecycle cases exercised login, secure cookies, profile/preferences, favorites, pantry creation/editing/inventory/archive/restore, password change, reauthentication, persistence and account deletion. Temporary fixtures were removed and foreign-key checks were clean.

The independent reviewer owns [ACCOUNT-VERIFICATION.md](ACCOUNT-VERIFICATION.md), including adversarial handler tests and actual browser findings. Unit/integration tests use temporary SQLite files. Verification/reset emails use an injected memory sink or deliberate transport failure; no external recipient was contacted. Browser tests use isolated fixture accounts, controlled map/provider responses where documented, and synthetic crowd data only in explicitly mocked cases. Successful browser checks do not establish real-world pantry inventory, visitor volume, walking accessibility, live transit or external mail delivery.

The production browser test server ran locally behind a temporary HTTPS proxy. Playwright's `REACH_TEST_LOCAL_TLS=true` permits that local test certificate only; external mail transport was not configured. Test databases, credentials, TLS keys, browser traces and build/dependency directories are excluded from the project download. There was no public deployment.

## Reproduce and operate

```sh
npm ci
npm run data:migrate
npm run check
npm run dev
```

Use Node 24. See `.env.example`, [AUTHENTICATION.md](AUTHENTICATION.md), and [SMTP setup](SMTP.md) for current mail configuration. Set `REACH_COMMUNITY_DB` to durable private storage on a single application host. Production account writes require the configured HTTPS origin. The community pilot still requires its explicit production enable flag.

After registering and verifying a real email account, use `npm run account:admin -- administrator@example.org` from a trusted server shell; the browser cannot bootstrap itself. Schedule `npm run data:prune` at least daily. Test backups/restoration, mail inbox delivery, HTTPS proxy configuration and ingress rate limiting before hosting publicly. SQLite instances must share one coherent database; independently deployed unshared or ephemeral instances are unsupported.

The new browser suites run with `REACH_TEST_URL` against a running server. `tests/account-management-live.spec.ts` additionally requires `REACH_ACCOUNT_TEST_DB` pointing to an explicitly isolated `/tmp/` server database; it creates offline-verified test fixtures, never real email verification. Community suites require `REACH_TEST_COMMUNITY=true` and isolated moderator credentials as described in [FEATURE-VERIFICATION.md](FEATURE-VERIFICATION.md). Tests using those gates must not be called passed when skipped.

## Delegation

Main integration retained architecture, public data flow, the final build, regression run and packaging. GPT-6 Astra handled account/security implementation and independent verification; GPT-6.1 Sol handled pantry storage and account/pantry interfaces; GPT-6 Luna handled bounded crowd aggregation work. File ownership was separated and security findings were returned for correction. No model cost or token savings are claimed.

See [PANTRY-DATABASE.md](PANTRY-DATABASE.md) for migrations/backups, [CROWD-METHOD.md](CROWD-METHOD.md) for evidence thresholds and retention, and [OPENSTREETMAP.md](OPENSTREETMAP.md) for unchanged external map/routing limits.
