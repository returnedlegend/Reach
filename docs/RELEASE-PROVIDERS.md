# Optional email and provider readiness

Current email supports [SMTP or private local preview](SMTP.md). A live installation needs its mail service’s authorized sender, private relay credentials, outbound TCP access, production origin and worker. Pantry inquiries additionally need a monitored reply mailbox. Automated tests do not establish inbox delivery. Provider-specific DNS configuration from the retired integration has been removed; no DNS change was made.

OpenRouter key metadata also authenticated. Its deprecated `rate_limit.requests=-1` field and a null spending limit are **not** a guarantee of unlimited free-model capacity. This task performed no inference or paid request. Production AI remains gated in core; manual planning is independent.

Full sanitized observations: [release provider evidence](evidence/release-providers.json). No hosting or DNS identity was available in the managed environment.
