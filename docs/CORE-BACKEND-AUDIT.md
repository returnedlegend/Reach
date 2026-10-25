# Core backend release audit

Reviewed 2026-10-24 against the checked-in implementation and the release-provider observations in [RELEASE-PROVIDERS.md](RELEASE-PROVIDERS.md). This is a focused code and local-test review, not a live provider check or a general security certification. No provider API, public DNS, email send, or external recipient was contacted during this review.

## Findings

No concrete authentication, outbound email, webhook, or outreach authorization defect was reproduced in the reviewed paths or focused test run. The current production default is the anonymous core profile: `coreRelease()` disables optional features in production unless the release profile is explicitly `extended`; even then, each production feature needs its corresponding `REACH_RELEASE_*` flag. See `src/lib/release-features.ts`. Account email requires an enabled account feature, a canonical origin, and an explicitly configured provider. Preview is unavailable in production. Missing or invalid configuration fails closed.

The former HTTP mail adapter and webhook findings are retired. Current delivery uses a configurable TLS SMTP relay or private local preview, with bounded attempts, sanitized errors and uncertain-outcome handling. See [SMTP setup](SMTP.md).

Account mutations require the configured same origin, JSON, an 8 KiB body limit, strict schemas, and persistent SQLite rate limits. Session cookies are HttpOnly and SameSite=Strict, gain Secure for HTTPS, and store only hashes server-side. Signup and recovery use generic responses; email tokens are purpose-bound and hashed. These controls are implemented in `src/lib/account.ts` and `src/lib/account-store.ts`. The account-status endpoint reports local configuration, not successful provider acceptance or inbox delivery.

Outreach requires a verified signed-in account, an enrolled active contact, explicit reviewed message authorization, and dispatch-time checks for revocation, contact changes, blocks, expiry and limits. Follow-ups remain opt-in and capped. Live SMTP outreach requires a monitored reply mailbox; incoming replies are handled manually. Existing saved replies retain private review and ownership checks.

## External release blockers

Production email needs an authorized SMTP sender, private relay credentials, network access, a canonical HTTPS origin and a persistent private database. SMTP acceptance does not prove inbox delivery. The current integration has no inbound email or delivery webhook.

The supported transport selections are explicit `smtp`, development-only `preview`, and `disabled`. An unset or unknown selection disables mail.

Persistent request and mail limits are shared through the local SQLite database. They are not distributed edge rate limits and do not establish multi-host safety. Existing account and release documentation already records the single-writer database and ingress-throttling limits; deployment must honor those constraints.

## Local verification

The historical October 24 run passed 69 tests across seven files for the implementation at that time. Mail adapter/webhook tests from that run have since been retired; this count does not describe the current suite.

After transport cleanup, 56 focused tests passed across eight suites, including account security, private preview verification, SMTP delivery, mail metadata/privacy, notification consent, and reviewed outreach. All used temporary databases or injected transports; no live mail was sent.

## Integration follow-up

SMTP support and the standalone startup helper remain. The previous provider-specific verification checklist has been retired. Current setup is documented in [SMTP.md](SMTP.md).
