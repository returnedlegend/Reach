# Core backend release audit

Reviewed 2026-10-24 against the checked-in implementation and the release-provider observations in [RELEASE-PROVIDERS.md](RELEASE-PROVIDERS.md). This is a focused code and local-test review, not a live provider check or a general security certification. No provider API, public DNS, email send, or external recipient was contacted during this review.

## Findings

No concrete authentication, outbound email, webhook, or outreach authorization defect was reproduced in the reviewed paths or focused test run. The current production default is the anonymous core profile: `coreRelease()` disables optional features in production unless the release profile is explicitly `extended`; even then, each production feature needs its corresponding `REACH_RELEASE_*` flag. See `src/lib/release-features.ts`. Account email requires an enabled account feature, a canonical origin, and an explicitly configured provider. Preview is unavailable in production. Missing or invalid configuration fails closed.

Account mutations require the configured same origin, JSON, an 8 KiB body limit, strict schemas, and persistent SQLite rate limits. Session cookies are HttpOnly and SameSite=Strict, gain Secure for HTTPS, and store only hashes server-side. Signup and recovery use generic responses; email tokens are purpose-bound and hashed. These controls are implemented in `src/lib/account.ts` and `src/lib/account-store.ts`. The account-status endpoint reports local configuration, not successful provider acceptance or inbox delivery.

## External release blockers

Persistent request and mail limits are shared through the local SQLite database. They are not distributed edge rate limits and do not establish multi-host safety. Existing account and release documentation already records the single-writer database and ingress-throttling limits; deployment must honor those constraints.

## Local verification

The historical October 24 run passed 69 tests across seven files for the implementation at that time. Mail adapter/webhook tests from that run have since been retired; this count does not describe the current suite.

## Integration follow-up
