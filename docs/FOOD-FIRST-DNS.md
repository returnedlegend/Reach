# Current Resend DNS follow-up

Checked 2026-10-25T00:42:13.907Z. Authenticated Resend metadata and public DNS were queried; domain verification was requested and accepted, but the resulting domain status remains **failed**. No email was sent and no DNS record was changed. The authoritative nameservers remain Afternic, not an undelegated AWS hosted zone.

These exact public authentication values came from the current domain API. Configure them only after establishing control of the authoritative zone, checking conflicts, and obtaining review before modifying existing production records. Preserve root inbound mail and avoid duplicate SPF policies.

| Type  | Host/name           | Exact required value                                                                                                                                                                                                         | Priority | TTL  | Status |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ------ |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcKnAOdf7R3frpmTdja3YDlVrsN6nASRPFCSbwV2eNUGU7BTk5uf9W3o37S3RF04eoM+rwtRpkzky8d1mhUHGw+SB6GtC3plGCR/9+v9yvu/ua16TyIho7P0b0ZF2EzgSmxRijbIyipAen9vEuwjU/rxWNnXC32MGse7wC1Nw0LQIDAQAB` | —        | Auto | failed |
| MX    | `send`              | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | 10       | Auto | failed |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | —        | Auto | failed |
| CNAME | `rsend`             | `send.forge.rmta.net`                                                                                                                                                                                                        | —        | Auto | failed |

The public queries returned `v=spf1 -all` for the DKIM and send TXT names, null MX for `send`, no `rsend` CNAME, and `v=spf1 -all` for `_dmarc`. These do not satisfy the returned authentication values. The `_dmarc` response is not a DMARC policy; inspect the authoritative zone before changing anything. A possible initial policy is `v=DMARC1; p=none`, explicitly a proposed policy rather than a record supplied by Resend or a change made here. Strengthen to quarantine/reject only after checking alignment for all legitimate senders.

The MX above is for the sending return path, not an instruction to replace root inbound mail. Once the owner applies correct records, query DNS and request verification again. Only a verified domain plus an explicitly authorized recipient permits a controlled sending test. API acceptance and inbox delivery are separate outcomes. No SMTP/API sending was exercised in this pass.

[Sanitized API/DNS evidence](evidence/food-first-domain-verification.json), [prior provider instructions](RELEASE-PROVIDERS.md), [server configuration](RESEND.md).
