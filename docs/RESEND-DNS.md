# Reach Resend domain authentication — current audit

> Current status update: the [October 24, 2026 read-only provider check](evidence/runtime-readiness.json) authenticated to Resend but returned **failed** for `reachemail.com` and all returned authentication records. The dated observations below remain historical evidence. No sending-domain success or live email delivery is established.

Checked October 24, 2026 (America/Chicago). **Sending is not verified. No DNS records were published and no email was sent.**

## Completed work and current status

- The requested Resend connector has no callable tools in this session. The existing official `resend` SDK 6.34.1 authenticated through the managed network proxy; no dependency or parallel email integration was added.
- The authenticated account did not list `reachemail.com`. The domain was added in `us-east-1` with open/click tracking disabled, then the official asynchronous verification operation was triggered. The current domain, DKIM, `send` MX and `send` SPF statuses are pending; the `rsend` CNAME status is `not_started`. Neither state means verified. Sending capability being enabled is also not proof of verification.
- Public DNS identifies **Afternic nameservers**: `ns3.afternic.com` and `ns4.afternic.com`. This identifies DNS hosting, not the registrar or the user's ownership. The owner identifies AWS as the DNS provider, but no AWS/DNS-management connector, configured cloud identity or common DNS-provider credential is available. The managed identity manifest has no connections and the selected AWS profile is the explicit no-identity guard; standard AWS credential/config files and AWS CLI/SDK are absent. That guard was not removed and no other AWS identity was substituted. No usable `_domainconnect` endpoint was discovered.
- The root and `send` MX responses are null MX (`0 .`), and root/`send`/DKIM-name TXT responses are `v=spf1 -all`. A random-label query returns the same TXT and null MX responses, consistent with wildcard DNS. These answers do not establish which names have explicit records in the provider's zone editor. No expected DKIM key, Amazon SES sending SPF or return-path MX was observed. `_dmarc` returns an SPF string, not a valid DMARC policy.
- The freshly retrieved DKIM differs from the latest value pasted in chat. Older instructions included a `send` CNAME, but the current API requires TXT and MX at `send`; publishing both that old CNAME and the new TXT/MX would conflict. Use the current records below, and re-fetch them if the Resend domain/account changes again. The `rsend` CNAME below is included because the current domain API actually returned it; do not replace it with a guessed target.

## Exact current Resend records — manual publication required

The following values come from the authenticated domain API, not a generic example. Enter relative host names if your DNS panel automatically appends `reachemail.com`. Leave priority blank except for MX. Use Auto TTL where offered (3600 seconds is a reasonable manual choice if Auto is unavailable).

| Type    | Host / name         | Value                                                                                                                                                                                                                        | Priority | TTL    |
| ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| `TXT`   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcKnAOdf7R3frpmTdja3YDlVrsN6nASRPFCSbwV2eNUGU7BTk5uf9W3o37S3RF04eoM+rwtRpkzky8d1mhUHGw+SB6GtC3plGCR/9+v9yvu/ua16TyIho7P0b0ZF2EzgSmxRijbIyipAen9vEuwjU/rxWNnXC32MGse7wC1Nw0LQIDAQAB` | `—`      | `Auto` |
| `MX`    | `send`              | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | `10`     | `Auto` |
| `TXT`   | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | `—`      | `Auto` |
| `CNAME` | `rsend`             | `send.forge.rmta.net`                                                                                                                                                                                                        | `—`      | `Auto` |

These records are **not installed**. The accompanying [CSV](evidence/resend-domain-records.csv) contains the same complete values. DKIM TXT is a public authentication key, not the secret Resend API key.

## Conflict handling and DNS-provider steps

1. Confirm that you own/control `reachemail.com` and identify its registrar or DNS management dashboard. The current nameservers are Afternic; do not assume a GoDaddy zone will be authoritative merely because Afternic is part of that group. Afternic parking may require using an authoritative DNS hosting service through the registrar. A nameserver change is a production change: plan preservation of all existing records and obtain owner confirmation before doing it.
2. In the current authoritative zone editor, inspect `resend._domainkey`, `send`, `rsend` and `_dmarc`, including wildcard policies. Request confirmation before modifying/removing any existing production record. Do not change root MX, root SPF, Workspace/Microsoft records, or other unrelated mail services. A null MX or deny-all response inherited from a wildcard can be overridden by a new explicit hostname, but only the DNS editor can establish that distinction.
3. Add the exact DKIM TXT, `send` MX, `send` SPF TXT and `rsend` CNAME above. Never publish two SPF policies beginning `v=spf1` at the same name. If `send` has an explicit existing policy, stop and review an approved merged policy instead of appending another TXT policy. A CNAME cannot coexist with other data at the same name; stop and request confirmation if `send` already has a CNAME or `rsend` has other records.
4. The MX is specifically at **send.reachemail.com** for sending feedback/Return-Path; it is not a root incoming-mail replacement and does not configure Reach's separate inbound reply feature.
5. After publication, query the exact names using `dig` or public resolvers, then click Verify in Resend. Verification is asynchronous; re-read individual record statuses and wait for `verified` before enabling sending. TTL caching can delay observation. A pending verification request is not evidence of successful DNS.

## AWS Route 53 instructions — owner-reported provider

The owner says AWS manages the domain. Public authoritative DNS nevertheless still reports Afternic; a Route 53 zone may exist but is not proven delegated. No authenticated AWS account/zone can be queried from this environment. Creating a hosted zone alone does not change public nameservers.

1. In AWS Console, open **Route 53 → Hosted zones**, select the **public** `reachemail.com` zone, and confirm it is the zone you intend to use. If multiple public zones exist, identify the intended zone before adding records. Do not use a private hosted zone for public mail authentication.
2. Compare its assigned NS record with the public Afternic nameservers in this report. If they differ, Route 53 changes will not yet be authoritative. Preserve/export the actual existing zone and plan migration first. Changing nameservers at the registrar requires explicit owner confirmation; that change was not requested or performed automatically here. If the registrar is AWS, inspect **Route 53 → Registered domains → reachemail.com → Name servers**. Otherwise use the actual registrar. Do not change the hosted-zone NS record to Afternic; delegation belongs at the registrar.
3. Once the intended zone and records are reviewed, choose **Create record → Simple routing**, enter each relative record name and type from the table, and use 3600-second TTL. Enter the MX value as `10 feedback-smtp.us-east-1.amazonses.com`. Enter the complete DKIM key as a TXT value; Route 53's console can quote it. The current key fits within one 255-byte TXT character string. Only use the currently retrieved values; do not combine old `send` CNAME instructions with the current MX/TXT records.
4. An exact [Route 53 change batch](evidence/resend-route53-create.json) is also ready for an authenticated AWS CLI. It uses **CREATE**, never UPSERT/DELETE, so any existing record at the same name/type fails the transaction instead of replacing it. Inspect CNAME conflicts and policies before applying; the batch is **not applied**. The hosted-zone ID must come from your account, not from this report:

   ```sh
   aws route53 change-resource-record-sets \
     --hosted-zone-id YOUR_REVIEWED_PUBLIC_HOSTED_ZONE_ID \
     --change-batch file://docs/evidence/resend-route53-create.json
   ```

   Use your deliberately selected authorized AWS profile/role. A management identity would need `route53:ListHostedZones` (or the narrower known-zone listing method), `route53:GetHostedZone`, `route53:ListResourceRecordSets`, and zone-scoped `route53:ChangeResourceRecordSets`; `route53:GetChange` can monitor propagation. Record-write permissions can be restricted to the specific names/types and `CREATE`. Registrar nameserver updates are a separate permission/action and must not be bundled with this change. No IAM access keys should be pasted into chat.

5. The separate [optional DMARC CREATE batch](evidence/resend-route53-dmarc-create.json) is **not part of** the required Resend batch. Review any existing DMARC before applying it; do not replace or weaken an existing production policy. It has no fabricated reporting mailbox.
6. Route 53 showing `INSYNC` only proves its own change propagated to its servers. Recheck public DNS delegation and the exact authentication names, then re-run Resend verification and confirm its final status.

## Initial DMARC proposal — not installed

After checking existing mail sources, publish a single TXT policy at `_dmarc`:

| Type | Host / name | Value               | Priority | TTL                    |
| ---- | ----------- | ------------------- | -------- | ---------------------- |
| TXT  | `_dmarc`    | `v=DMARC1; p=none;` | —        | Auto (or 3600 seconds) |

This monitoring policy is a proposed configuration based on Resend's official guidance, not a value returned by its domain API. The current resolver response is not a valid DMARC policy; establish whether it is inherited from a wildcard or an explicit production record before changing anything. `p=none` does not enforce rejection. No reporting mailbox is invented: add `rua=mailto:...` only for a real, authorized receiving mailbox or monitoring service. Observe SPF/DKIM alignment and legitimate senders before owner-approved tightening to `p=quarantine`, then `p=reject`; avoid weakening any existing stricter valid policy.

## Reach application configuration and remaining delivery checks

- The ignored mode-0600 `.env.local` already holds `RESEND_FROM_EMAIL="Reach <notifications@reachemail.com>"`; its injected server-side `RESEND_API_KEY` authenticates. Keys were not copied into source, DNS records, reports or client code. `.env.example` retains placeholders. Preview remains deliberately selected until verification succeeds; no automatic sending/worker dispatch has occurred.
- After verification, set `REACH_EMAIL_PROVIDER=resend`, retain the verified sender, and restart both app and worker with the same private environment/database. A production `REACH_APP_ORIGIN` must be the actual canonical HTTPS origin. The current local origin is not a public deployment. Existing Google sign-in and AI email drafting remain independent and unchanged.
- Account and notification sends already use server-only endpoints, authorization, rate limits, stable per-operation idempotency, sanitized errors and bounded metadata. Provider acceptance, uncertain outcomes and signed delivery events are separate; no new recipient/message-body logging was introduced.
- Real pantry inquiries additionally need an app-controlled receiving subdomain, authorized receiving API access, `RESEND_INBOUND_WEBHOOK_SECRET`, `REACH_OUTREACH_REPLY_DOMAIN` and the signed `/api/outreach/inbound` endpoint. This domain currently has receiving disabled. Do not put incoming-mail MX at the root to bypass that setup or silently remove the inquiry guard.
- A delivery webhook (`/api/email/webhook`, separate `RESEND_WEBHOOK_SECRET`) and a reachable deployed HTTPS endpoint are needed for signed delivery status updates. Neither is claimed live-tested here.
- No destination was authorized for a controlled test email, and DNS is not verified. Once both requirements are satisfied, send one reviewed test, record API acceptance separately, and inspect the recipient's inbox/headers for delivery and DMARC alignment. A successful SDK domain request is not email delivery.

## Verification evidence

- [Sanitized public DNS and live domain audit](evidence/resend-domain-dns.json): real SDK domain listing, creation and verification trigger; real public DNS queries. No credentials, private messages, recipients or provider raw errors are stored.
- Independent read-only review (`gpt-6-luna`, high reasoning) inspected the central delivery service, account origin rules, inquiry authorization/dispatch and signed inbound handling. It found no source defect blocking a correctly configured verified sender. Its four selected fixture suites passed **43 tests**. These results do not prove external delivery.
- Main-agent targeted tests passed **55/55 across six files** (`resend-verification`, `mail-delivery`, `mail-security`, `outreach-worker`, `smtp-outreach`, `account-security`). These use fixtures, not real email delivery. The final real SDK check at 08:51 AM America/Chicago returned **pending**, with unchanged DNS values and `verifiedForSending:false`. No application source changes were needed, so the previous production build result is not represented as a new build.

## Official sources checked

- [Resend domain introduction](https://resend.com/docs/dashboard/domains/introduction)
- [Retrieve a domain](https://resend.com/docs/api-reference/domains/get-domain)
- [Verify a domain — asynchronous operation](https://resend.com/docs/api-reference/domains/verify-domain)
- [DMARC setup and progressive enforcement](https://resend.com/docs/dashboard/domains/dmarc)
- Google public DNS-over-HTTPS responses captured in the evidence JSON; actual zone-editor access remains blocked.

- [AWS: migrating DNS to Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html)
- [AWS: creating records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-creating.html)

## Final local checks

- `npm run typecheck`: passed.
- `git diff --check`: passed; new Markdown/JSON files formatted with the existing formatter.
- Exact artifact assertions: four required Route 53 values/types/names match the authenticated API evidence, all actions are CREATE, no private runtime credential values appear in public artifacts, and `.env.local` remains ignored/mode 0600.
- Independent reviewer rechecked the final AWS payloads and runbook: valid TXT quoting and MX preference, MX/TXT coexistence, FQDN CNAME/MX targets, separate optional DMARC, and no UPSERT/DELETE. Public DNS was independently rechecked. No application source files changed; the production build was not repeated.

## Final completion boundary

Completed: live authenticated domain creation, exact DNS retrieval, public conflict/delegation audit, asynchronous verification trigger and final status read, AWS CREATE-only change files, existing sender/configuration review and fixture verification. Blocked: publishing DNS (no authenticated AWS/DNS identity, hosted-zone ID or confirmed delegation), successful domain verification, real sending/receiving setup and controlled email delivery (no verified domain or authorized test destination). No production record, nameserver, root MX, app credential or sending-mode change was made.
