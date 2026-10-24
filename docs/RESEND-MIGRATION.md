# Postal to Resend migration

## Implementation

Reach now uses the official pinned Resend Node SDK through one reusable server-side delivery boundary. Account verification, legacy email attachment, password recovery, welcome/security messages, pantry notices and volunteer/pickup notifications keep the existing authentication database, token lifecycle, consent checks and queue. The existing email-verification confirmation also serves as the welcome message; it does not create a second welcome job.

Resend acceptance is distinct from receiving-server delivery. Requests have stable per-operation idempotency keys, bounded throttling retries and private error handling. Ambiguous outcomes, including concurrent idempotent sends, remain uncertain without automatic resending or invalidating potentially delivered account links. The signed raw-body webhook is `/api/email/webhook`; tracking events and provider diagnostics are not retained.

The SQLite upgrade preserves previous delivery IDs, provider labels, status/history and outbox links while accepting opaque Resend message IDs. Historical Postal rows are inert. Postal HTTP/SMTP transport code, Nodemailer dependencies and the previous webhook route are removed. The SDK's transitive `postal-mime` dependency is an unrelated MIME parser. Postal-address/ZIP and location data are unchanged.

HTML and plain-text templates retain safe links and escaping. The HTML uses Reach's teal/slate palette, mobile layout, presentation tables, large actions and visible URL fallbacks. Browser rendering does not establish compatibility with every external mail client.

## Local environment and manual setup

The actual ignored file `/workspace/Reach/.env.local` contains placeholder `RESEND_API_KEY` and `RESEND_FROM_EMAIL` assignments. Existing settings were preserved; local preview remains selected. The file has mode 0600, is not tracked and is excluded from source downloads. Do not paste credentials into chat or source files.

For live sending:

1. In Resend, add a domain you control and publish the exact DNS authentication records shown for it. Wait for verified status; configure DMARC as appropriate for the domain.
2. Replace the local placeholders with your sending API key and an address on that verified domain. Set `REACH_EMAIL_PROVIDER=resend`. Production also needs the canonical HTTPS `REACH_APP_ORIGIN`.
3. Restart the app and use the same secure settings and persistent SQLite database for the notification worker. Back up the database before upgrading.
4. Optionally configure `/api/email/webhook` in Resend and set its server-only `RESEND_WEBHOOK_SECRET`. Verify real acceptance and delivery separately before relying on mail.

See [the complete setup and official references](RESEND.md) and [independent verification](RESEND-VERIFICATION.md). No live API key, sender domain or real delivery was tested, and no deployment was performed.

## Verification

- [Final `npm run check`](evidence/resend-check.txt): exit 0; 317 tests in 28 files, TypeScript, data validation (24 production pantries; separate six-record fictional demo) and production build passed. The inherited whole-project filesystem-tracing warning is fixed.
- [Browser verification](evidence/resend-browser.txt): clean final 52/52 across phone, Android-sized, tablet and desktop Chromium profiles. Real local preview signup, verification, sign-in and recovery use the actual account API and isolated SQLite; UI fixtures separately cover notification consent/state and email accessibility/layout. This is not physical-device or external-mail-client testing.
- An earlier matrix had one mobile notice timeout after HTTP 202; an isolated retry and the entire clean final matrix passed without changing the assertion. Its cause remains inconclusive; earlier TLS-proxy attempts were test-harness failures and were not counted as successful checks.
- [Security evidence](evidence/resend-security.json): production dependency audit reported zero known vulnerabilities; local environment is ignored/private, and the independent final client scan found none of the server-only Resend markers in 35 assets.
- A dedicated independent reviewer inspected code, source documentation, metadata/schema preservation and observed browser behavior. [Its report](RESEND-VERIFICATION.md) distinguishes passes from unavailable live checks.
- Documentation, responsive HTML templates/layout checks, transport/security tests and independent review were delegated to four `gpt-6-luna` agents with high reasoning. The main agent implemented the central delivery/schema/webhook architecture, reviewed contributions and ran the final checks. No token or monetary savings were measured.

Mock SDK responses and private preview captures are not live Resend delivery. No API acceptance, sender DNS verification, inbox delivery or production webhook event was exercised against a real Resend account.

## Files

The following manifest compares the source tree with the pre-migration source archive. Renamed tests are shown as a deletion and creation. `.env.local` was modified locally and is intentionally outside the archive.

### Created

- `docs/RESEND-MIGRATION.md`
- `docs/RESEND-VERIFICATION.md`
- `docs/RESEND.md`
- `docs/evidence/resend-browser.txt`
- `docs/evidence/resend-check.txt`
- `docs/evidence/resend-files.json`
- `docs/evidence/resend-security.json`
- `docs/evidence/resend-unit.txt`
- `migrations/mail-001.sql`
- `src/app/api/email/webhook/route.ts`
- `src/lib/mail-delivery.ts`
- `src/lib/mail-schema.ts`
- `src/lib/resend-webhook.ts`
- `tests/email-account-live.spec.ts`
- `tests/email-ui.spec.ts`
- `tests/mail-delivery.test.ts`
- `tests/mail-security.test.ts`
- `tests/resend-verification.test.ts`

### Modified

- `.env.example`
- `README.md`
- `docs/ACCOUNT-INTEGRATION.md`
- `docs/ACCOUNT-VERIFICATION.md`
- `docs/AUTHENTICATION.md`
- `docs/DAISY-AUDIT.md`
- `docs/DAISY-DESIGN.md`
- `docs/POSTAL-INTEGRATION.md`
- `docs/POSTAL-TRANSPORT.md`
- `docs/POSTAL-VERIFICATION.md`
- `docs/POSTAL.md`
- `docs/REDESIGN-FUNCTIONAL.md`
- `docs/UI-REDESIGN.md`
- `docs/VERIFICATION.md`
- `docs/VOLUNTEER-COORDINATION.md`
- `next-env.d.ts`
- `package-lock.json`
- `package.json`
- `src/components/account-panel.tsx`
- `src/components/notification-preferences.tsx`
- `src/lib/email-templates.ts`
- `src/lib/mail-account.ts`
- `src/lib/notifications-worker.ts`
- `tests/account-management-live.spec.ts`
- `tests/account-security.test.ts`
- `tests/account.test.ts`
- `tests/email-layout.spec.ts`

### Deleted or replaced

- `migrations/postal-001.sql`
- `src/app/api/postal/webhook/route.ts`
- `src/lib/postal-delivery.ts`
- `src/lib/postal-webhook.ts`
- `tests/postal-account-live.spec.ts`
- `tests/postal-delivery.test.ts`
- `tests/postal-security.test.ts`
- `tests/postal-ui.spec.ts`

Local ignored change: `.env.local` (existing values preserved; Resend placeholders added). The existing `.gitignore` already excludes `.env*` except `.env.example`, so no change to it was needed. [Machine-readable manifest](evidence/resend-files.json).
