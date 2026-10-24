# Current optional email / DNS blocker

Checked 2026-10-24T21:15:03.559Z. Read-only Resend metadata authenticated successfully, but `reachemail.com` is `failed`. No email was sent and no DNS record was changed. Email stays disabled in the core release.

Public DNS still delegates to `ns3.afternic.com` and `ns4.afternic.com`, not an AWS Route 53 zone. An undelegated AWS hosted zone does not control these answers. Domain ownership/DNS-management authorization is not established by adding a domain in Resend. The observed root and return-path MX answers are null MX; the queried TXT names returned `v=spf1 -all`, including the DKIM/DMARC names. These do not satisfy the Resend records.

These are the exact records returned by the current authenticated domain API; DKIM is a public verification key, not an API secret. Obtain current values again before editing, inspect conflicts, and preserve unrelated production mail records.

| Type  | Host/name          | Required value                                                                                                                                                                                                               | Priority | TTL  | API status |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ---------- |
| TXT   | resend.\_domainkey | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcKnAOdf7R3frpmTdja3YDlVrsN6nASRPFCSbwV2eNUGU7BTk5uf9W3o37S3RF04eoM+rwtRpkzky8d1mhUHGw+SB6GtC3plGCR/9+v9yvu/ua16TyIho7P0b0ZF2EzgSmxRijbIyipAen9vEuwjU/rxWNnXC32MGse7wC1Nw0LQIDAQAB` | —        | Auto | failed     |
| MX    | send               | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | 10       | Auto | failed     |
| TXT   | send               | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | —        | Auto | failed     |
| CNAME | rsend              | `send.forge.rmta.net`                                                                                                                                                                                                        | —        | Auto | failed     |

Configure these only in the authoritative zone after confirming its control. The MX is for the `send` return-path subdomain; it is not an instruction to replace inbound mail at the root. Do not create conflicting SPF policies or overwrite existing Google/Microsoft mail. Existing production record changes require review. Then query public DNS, trigger Resend verification, inspect each record, and test a specifically authorized recipient. API acceptance and inbox delivery remain separate checks. Reply receiving needs separate MX/webhook/authorization configuration.

OpenRouter key metadata also authenticated. Its deprecated `rate_limit.requests=-1` field and a null spending limit are **not** a guarantee of unlimited free-model capacity. This task performed no inference or paid request. Production AI remains gated in core; manual planning is independent.

Full sanitized observations: [release provider evidence](evidence/release-providers.json). No hosting or DNS identity was available in the managed environment.
