# Resend SMTP delivery

Reach can send through Resend SMTP when `REACH_EMAIL_PROVIDER=smtp` is set explicitly. SMTP is disabled unless the complete configuration below validates. It never falls back to preview or the Resend HTTP API.

```dotenv
REACH_EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=re_... # Resend API key; keep server-side
SMTP_FROM_EMAIL=mail@your-verified-domain.example
SMTP_FROM_NAME=Reach
```

Port 465 requires implicit TLS (`SMTP_SECURE=true`). Port 587 requires `SMTP_SECURE=false`; Reach requires STARTTLS before authentication. Other hosts, ports, security combinations, sender placeholders, and placeholder API keys disable SMTP. TLS certificate validation stays enabled. Connection, greeting, and socket timeouts are 10 seconds. Reach does not enable Nodemailer debug or transport logging.

SMTP acceptance means the Resend SMTP relay accepted the message for processing. It does not mean the recipient's server delivered it or that the recipient read it. When available, Reach stores the RFC `Message-ID` separately from an opaque provider ID. Resend's published SMTP guide documents `Resend-Idempotency-Key`, but does not specify a stable SMTP response ID grammar; Reach does not guess one from server reply text. A transport/network error without an explicit SMTP refusal is recorded as `uncertain` and is not automatically resent, since the relay may already have accepted the message. An explicit temporary 4xx refusal can be retried within the normal bounded attempt limit.

Application validation, rate limits, templates, and outbox metadata remain in the shared `deliverMail` boundary. Mail bodies and credentials are not stored in the delivery metadata table. SMTP credentials must remain server-side and should be rotated like other Resend API keys. Reach applies a 20-second overall send deadline, closes the transport on expiry, and records `uncertain` without retrying. A subsequent worker lease does not establish whether the first relay accepted the message; operators should review uncertain deliveries before any manual resend.

The runtime needs outbound TCP access to `smtp.resend.com` on the selected SMTP port. Network policy must explicitly grant that egress; automated tests inject a mock transport and make no TCP connection.

References: [Resend SMTP settings and documented `Resend-Idempotency-Key` header](https://resend.com/docs/send-with-smtp), [Nodemailer SMTP transport](https://nodemailer.com/smtp/).
