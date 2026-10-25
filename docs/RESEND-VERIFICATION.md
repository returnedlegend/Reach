# Postal to Resend verification gate

This checklist preserves historical local verification evidence from the Postal-to-Resend migration; it is not a current inventory of every supported transport. It does not claim that Resend accepted or delivered a live message. Account and notification flows must use isolated SQLite data and mocked provider responses or the existing private local preview mode. The current code also supports the explicit `REACH_EMAIL_PROVIDER=smtp` setting through the Resend SMTP adapter in `src/lib/smtp-delivery.ts`.

## Security and behavior checks

- [x] Historical migration check: Postal delivery was removed, and production preview remained disabled. The migration checklist's claim that SMTP/Nodemailer had been removed is stale; the current code supports an explicitly selected Resend SMTP adapter.
- [x] The pinned Resend SDK is `6.34.1`. Sending uses the SDK's `emails.send` contract, one recipient, the configured sender, and only the message fields needed by Reach.
- [x] The Resend API key stays server-side. Outside the explicit private local preview, provider errors, request bodies, account tokens, notification contents/recipients, and webhook payloads are not logged or stored; delivery ledgers and event history retain approved metadata only.
- [x] The SDK request boundary fixes HTTPS Resend API access, disallows redirects, bounds requests and responses, times out, and does not let development SDK error logging expose provider responses.
- [x] Explicit retryable failures may retry within the local cap; timeouts, connection loss, server errors, and malformed success responses become `uncertain` without a second send. A possibly accepted account link remains valid.
- [x] Database rate limits, delivery ledger metadata, notification consent/rate limits, and uncertain outbox handling remain enforced.
- [x] Existing Postal delivery rows survive the `provider_message_id` INTEGER-to-TEXT migration with the same row IDs and values; Postal event history stays inert.
- [x] The webhook accepts only POST, verifies the exact raw body through Resend SDK `webhooks.verify` using `svix-id`, `svix-timestamp`, and `svix-signature`, bounds input, rejects stale/invalid events, deduplicates event IDs, and stores only approved delivery metadata.
- [x] The webhook maps only relevant Resend delivery events and ignores opens, clicks, recipient details, and diagnostic text.
- [x] Account verification, email attachment, recovery, password-change notices, welcome/security notices, and optional notifications retain their existing token validity, consent, and unsubscribe behavior.
- [x] Production client bundles contain no Resend key or provider-only server code. The local environment file exists and is ignored; verify names and presence without printing values.

## Evidence

| Check                                             | Result  | Evidence                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend SDK API contract                           | Pass    | Resend `6.34.1` declarations/source; [send email API](https://resend.com/docs/api-reference/emails/send-email) and [webhook guide](https://resend.com/docs/dashboard/webhooks/introduction); `svix-*` signature verification verified with the SDK                     |
| Unit tests                                        | Pass    | Full suite: 317/317; focused mail delivery/security/verification suites: 36/36; account and account-security suites: 25/25                                                                                                                                             |
| Account and notification flows with mocks/preview | Pass    | `tests/resend-verification.test.ts` exercises signup, verification, welcome/security notification dispatch, and password reset with isolated SQLite/private preview                                                                                                    |
| SQLite migration preservation                     | Pass    | `tests/mail-delivery.test.ts` checks INTEGER-to-TEXT provider ID migration and retained delivery/outbox links                                                                                                                                                          |
| Browser preview/account flows                     | Pass    | Clean post-build HTTP preview matrix: 52/52 across mobile, Android, tablet, and desktop, including signup, verification, recovery, and notifications. Earlier isolated mobile notice timeout did not recur; [sanitized browser evidence](evidence/resend-browser.txt). |
| Client bundle and environment hygiene             | Pass    | Final `.next/static` scan: 35 assets; no Resend API key/webhook secret, API endpoint, SDK verification code, or private transport class. `.env.local` is mode 600 and ignored; expected variable names only inspected.                                                 |
| Live provider acceptance or delivery              | Not run | No production API key or verified sender/domain was configured; no live send was attempted.                                                                                                                                                                            |
