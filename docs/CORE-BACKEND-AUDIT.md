# Core backend release audit

Reviewed 2026-10-24 against the checked-in implementation and the release-provider observations in [RELEASE-PROVIDERS.md](RELEASE-PROVIDERS.md). This is a focused code and local-test review, not a live provider check or a general security certification. No provider API, public DNS, email send, or external recipient was contacted during this review.

## Findings

No concrete authentication, outbound email, webhook, or outreach authorization defect was reproduced in the reviewed paths or focused test run. The current production default is the anonymous core profile: `coreRelease()` disables optional features in production unless the release profile is explicitly `extended`; even then, each production feature needs its corresponding `REACH_RELEASE_*` flag. See `src/lib/release-features.ts`. Account email requires an enabled account feature, a canonical origin, and an explicitly configured provider. Preview is unavailable in production. Missing or invalid configuration fails closed.

The Resend adapter validates the presence and shape of a server-side key and sender address, pins requests to `https://api.resend.com`, rejects redirects, bounds and times requests/responses, and reduces provider failures to generic errors and a small set of approved retry classifications. Send requests have one recipient and a stable per-delivery idempotency key. Accepted, uncertain, and later verified webhook delivery states remain distinct. See `src/lib/mail-delivery.ts` and `src/lib/resend-webhook.ts`.

Account mutations require the configured same origin, JSON, an 8 KiB body limit, strict schemas, and persistent SQLite rate limits. Session cookies are HttpOnly and SameSite=Strict, gain Secure for HTTPS, and store only hashes server-side. Signup and recovery use generic responses; email tokens are purpose-bound and hashed. These controls are implemented in `src/lib/account.ts` and `src/lib/account-store.ts`. The account-status endpoint reports local configuration, not successful provider acceptance or inbox delivery.

Outreach requires a verified signed-in account, an enrolled active contact, per-message user authorization, an explicit reviewed draft with the required AI disclosure, and dispatch-time checks for revocation, contact changes, blocks, authorization expiry, and send limits. Follow-ups require explicit opt-in and are capped. Replies are accepted only through a signed Resend webhook, correlated to a sent thread and enrolled address, and labeled as unverified sender input pending review. See `src/lib/outreach.ts`, `src/lib/outreach-worker.ts`, and `src/lib/outreach-inbound.ts`.

## External release blockers

The existing provider report says authenticated Resend domain metadata returned `failed` for `reachemail.com`; public DNS is delegated to Afternic rather than the observed AWS zone, and no DNS-management or hosting identity was available. It records no email send and no DNS edit. Those observations are in [RELEASE-PROVIDERS.md](RELEASE-PROVIDERS.md) and its sanitized evidence file. This review did not re-query them. A verified Resend sender/domain and control of the authoritative DNS zone remain prerequisites to enabling production email. Outreach additionally needs the app-controlled receiving domain, a receive-capable Resend API key, a separate inbound webhook secret, and an independently configured `email.received` webhook; current docs state this has not been verified.

The code accepts `REACH_EMAIL_PROVIDER=smtp` and contains a Resend SMTP adapter (`src/lib/mail-delivery.ts`, `src/lib/smtp-delivery.ts`). This conflicts with the checklist in `docs/RESEND-VERIFICATION.md`, which says SMTP/Nodemailer transport has been removed and lists only `resend`, `preview`, and `disabled`. `docs/RESEND.md` and `docs/SMTP.md` describe SMTP as supported. Treat the verification checklist's SMTP-removal statement as stale; no transport was removed as part of this audit.

Persistent request and mail limits are shared through the local SQLite database. They are not distributed edge rate limits and do not establish multi-host safety. Existing account and release documentation already records the single-writer database and ingress-throttling limits; deployment must honor those constraints.

## Local verification

Ran:

```sh
npx vitest run tests/account-security.test.ts tests/account.test.ts tests/mail-security.test.ts tests/mail-delivery.test.ts tests/resend-verification.test.ts tests/outreach-worker.test.ts tests/smtp-outreach.test.ts
```

Result: **69 tests passed across 7 files**. These exercise isolated databases, injected/mock delivery, token/session/origin checks, provider error handling, webhook signatures, and outreach consent/revalidation. They do not establish Resend connectivity, DNS verification, actual delivery, production secret injection, deployment TLS/proxy behavior, or live inbound mail.

## Integration follow-up

The coordinator corrected the historical SMTP-removal checklist in `RESEND-VERIFICATION.md` after this audit. Explicit SMTP support remains. A new standalone startup helper was subsequently implemented and production-smoke-tested by the coordinator; that runtime work is separate from the 69-test review above.
