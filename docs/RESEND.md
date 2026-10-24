# Resend email setup

Reach sends account verification, recovery, security notices and consent-based
notifications through one server-side mail delivery service. The current local
workflow remains private preview: it writes captures to a private directory and
sends no external email. Production delivery supports the pinned `resend` Node SDK
version 6.34.1 or explicitly selected Resend SMTP through Nodemailer, on Node.js 24.
The current SMTP and conversational-assistant setup is documented in
[SMTP + AI setup](SMTP-AI-SETUP.md).

## Availability inquiries and inbound replies

The same central Resend service now also supports explicitly reviewed, consent-limited pantry/household inquiries. `scripts/mail-worker.ts` dispatches both queues. Optional follow-ups, cancellation, suppression, contact-change cancellation, private reply review and expiry are described in [the food-access planner guide](ACCESS-PLANNER.md). This queue stores private message bodies and replies; it is distinct from the existing metadata-only notification queue.

Real outreach additionally requires an app-controlled receiving domain, a receiving-capable server API key (`RESEND_INBOUND_API_KEY`, or the existing key with the required permissions), a separate `RESEND_INBOUND_WEBHOOK_SECRET`, and `REACH_OUTREACH_REPLY_DOMAIN`. Configure `email.received` at `/api/outreach/inbound`, separately from `/api/email/webhook`. Exact configuration and identity/privacy limits are in [the receiving setup](ACCESS-PLANNER.md#real-resend-receiving-setup). No live outreach or receiving request has been verified. Preview remains selected locally.

## Local development

Use Node 24. Add these values to the ignored `.env.local`, preserving other
settings:

```dotenv
REACH_EMAIL_PROVIDER=preview
REACH_APP_ORIGIN=http://localhost:3000
REACH_EMAIL_PREVIEW_DIR=.local/mail-preview
```

Use the actual development port for `REACH_APP_ORIGIN`. Run `npm run dev`. Next
loads `.env.local` for the app, but the standalone worker does not. In another
terminal, load the same settings explicitly:

```sh
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch
```

Use `--once` for a single dispatch. The app and worker must use the same database
and origin. After registering a local account, privately inspect its JSON capture
under `.local/mail-preview` to access the rendered link. Captures contain live
account links: do not share them and delete them after use. Preview is disabled in
production; there is no HTTP preview endpoint or automatic fallback.

## Production setup

1. Create a Resend account and an API key with only the permissions needed to send
   from the verified domain. Keep the key in the production secret manager; never
   commit it or expose it through a `NEXT_PUBLIC_` variable.
2. Add a domain you control in the Resend dashboard. Publish the exact DNS records
   Resend provides for that domain, including its sending authentication records,
   then wait for Resend to report the domain as verified. Do not copy generic
   record values from another domain or create a second SPF record; update the
   existing SPF policy if Resend's instructions require it. Configure DMARC for
   your domain and check alignment and deliverability separately.
3. Set these server-side values in `.env.local` for a private deployment or in
   your production environment settings:

   ```dotenv
   REACH_EMAIL_PROVIDER=resend
   REACH_APP_ORIGIN=https://reach.yourdomain.com
   RESEND_API_KEY=your_resend_api_key_here
   RESEND_FROM_EMAIL="Reach <notifications@yourdomain.com>"
   ```

   `RESEND_FROM_EMAIL` must use a sender domain verified in Resend. Production
   requires the canonical application origin over HTTPS. Use the exact public
   origin with no trailing slash; account links are generated from this setting,
   not from request headers. Do not use a local, preview, or temporary deployment
   URL as the production origin. The sample API key and sender address are
   placeholders; replace them with the real server-side key and your verified
   sending domain before selecting the Resend provider.

4. Keep the same canonical origin, persistent private SQLite database, and
   provider settings available to the supervised notification worker. Start it
   with securely injected production variables using
   `NODE_ENV=production npm run mail:worker -- --watch`, or schedule bounded
   `--once` runs with the same environment. The worker must share the
   application's database. This single-host SQLite setup does not support
   ephemeral disks or independent unshared replicas.
5. Before relying on account mail, use Resend's dashboard to confirm domain
   verification and inspect provider logs. An API acceptance response confirms
   that Resend accepted a request; it does not prove inbox delivery. Configure
   delivery webhooks below if Reach needs provider delivery outcomes.

## Delivery webhooks

When delivery events are needed, configure a Resend webhook for the deployed
HTTPS endpoint:

```text
https://reach.yourdomain.com/api/email/webhook
```

Copy that endpoint's signing secret from Resend into the server-only
`RESEND_WEBHOOK_SECRET` setting. Configure the webhook for the email delivery
events Reach handles, then send a dashboard test event and confirm that the
endpoint accepts a valid signature. The handler verifies the exact raw request
body with the Resend SDK and the `svix-id`, `svix-timestamp`, and `svix-signature`
headers. Do not parse and reserialize the body before signature verification,
trust event fields without verification, or log webhook bodies. Keep the signing
secret private and rotate it in Resend and the application environment together.

Resend retries failed webhook delivery and allows manual replay of both failed
and successful messages. Reach treats repeated event IDs idempotently and applies
status updates without regressing stronger final delivery states. Check Resend's
webhook message details and retries when an event does not reach the endpoint. A
successful webhook signature proves the event came from the configured Resend
endpoint; it does not prove that the recipient read the message.

## Delivery states and retry limits

The application distinguishes disabled delivery, local preview, provider
acceptance, uncertainty, and delivery events. `accepted` means Resend accepted
the send request. For HTTP API sends with a matched provider message ID, a later verified
`email.delivered` webhook is evidence of
provider delivery to the receiving mail server; neither status proves that a
person read the message. Bounce, failure, and delay events are separate outcomes.

If a connection fails after a send request may have reached Resend, the result can
be uncertain. Do not blindly resend: the original may already be queued, and an
account link could arrive twice. Resend supports an `Idempotency-Key` for a send
request; keys must be unique per operation, 1–256 characters, and expire after 24
hours. Reach sends `reach-email/<ledger UUID>` as the key and reuses it only for
bounded explicit rate-limit retries within that delivery call. Queue deduplication
handles repeated events, while a crashed or uncertain send is not retried
automatically. Resend's key does not resolve every uncertain outcome after it
expires. The application records bounded delivery metadata and
does not store email bodies, recipient addresses, action links, API credentials,
provider diagnostics, or webhook payloads in its delivery history. Optional
notifications continue to require current consent and authorization at dispatch.

Resend documents `concurrent_idempotent_requests` as HTTP 409 when another request
with the same key is still in progress. That response does not establish whether
the original send has been accepted, so Reach treats it as uncertain and does not
retry automatically with a new key. A new key would bypass deduplication while
the original request may still complete.

If sending fails, check the sender address against Resend's verified domains and
check that the active API key is present and valid. Resend documents an unverified
sender domain as a `403 validation_error`, and a missing API key as `401`; rate
limits and daily or monthly quotas return `429` classes. Do not expose raw provider
errors or credentials in client responses or logs.

If Resend is unavailable or configuration is incomplete, account email operations
report failure rather than falling back to preview or another provider. Existing
accounts can still sign in. The mail worker uses the same provider and origin as
the app.

SMTP acceptance records an RFC Message-ID, which is distinct from Resend’s opaque
HTTP API message ID. Reach does not invent a webhook mapping between them. SMTP
mail remains accepted or uncertain unless a separately supported correlation is
available; inbox delivery has not been verified.

## Migration from Postal

Postal sending remains removed. Replace legacy Postal settings with the Resend
HTTP settings above or the supported [Resend SMTP settings](SMTP.md).
`REACH_EMAIL_PROVIDER=postal` is unsupported; `smtp` now explicitly selects the
new Resend SMTP adapter and requires all documented SMTP variables. Existing mail-delivery rows tagged with
`provider='postal'` remain inert historical records. They are not resent, imported
into Resend, or treated as Resend message IDs. Back up the SQLite database before
upgrading and confirm the schema migration completed before enabling production
sends.

## Official references

- [Resend: send emails with Node.js](https://resend.com/docs/send-with-nodejs)
- [Resend: verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend: send email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend: webhooks overview](https://resend.com/docs/dashboard/webhooks/introduction)
- [Resend: webhook retries and replays](https://resend.com/docs/webhooks/retries-and-replays)
- [Resend: verify webhook requests](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend: API errors](https://resend.com/docs/api-reference/errors)

The documentation links above were checked on October 22, 2026. Local tests do
not verify a Resend account, DNS records, sender alignment, external connectivity,
inbox placement, or production webhook delivery.

The `postal-mime` package can appear as a transitive MIME parser dependency. It
parses email MIME content and is unrelated to the Postal mail server or its HTTP
transport; it does not mean Postal sending support remains in Reach.
