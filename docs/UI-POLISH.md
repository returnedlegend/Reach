# Reach interface and email cleanup — 2026-10-25

## Implemented

- Food-first discovery uses a shared inline loading indicator inside **Find best resources**. Two lightweight skeleton cards indicate comparison work while existing cards, navigation and the map remain usable. No blocking overlay or forced scroll during AI work.
- Search guards suppress duplicate submissions. Editing a pending request invalidates its response; cancellation and retry retain useful directory results. Preference interpretation also cancels stale work. Assistant and outreach requests have bounded client deadlines.
- Loading controls have explicit accessible names; reduced-motion preferences disable animation. The layout retains dark/light themes and large mobile controls.
- Each pantry card can select its location on the map. Initial map framing includes the selected origin and destination or route. Real route geometry and directory facts remain separate from fixtures.
- Removed the former email provider SDK, API transport, webhook routes and configuration. Existing SMTP, private development preview, templates, authorization, rate limits and database history remain. Replies require a monitored mailbox and are not automatically imported. Live automatic follow-ups are disabled because SMTP alone cannot detect replies.

## Configuration

See [.env.example](../.env.example), [SMTP](SMTP.md) and [AI](AI-CONFIGURATION.md). Local inference uses `REACH_AI_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` and `OLLAMA_TIMEOUT_MS`; the configured service must be reachable from the Next.js server. Feature and data-policy gates still apply.

Live email requires `REACH_EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, a canonical `REACH_APP_ORIGIN`, and enabled email features. Outreach additionally requires `REACH_OUTREACH_REPLY_EMAIL` pointing to a mailbox an operator monitors. Preview never establishes real delivery and is disabled in production. Keep credentials in ignored local files or deployment secrets.

## Release boundary

These changes are ready for code review, not evidence that every external service is production-ready. The UI can keep directory results useful during provider failure. Live AI latency, SMTP acceptance/inbox delivery, OAuth configuration and deployment-specific provider capacity must be checked on the target host. Pantry stock, eligibility, pedestrian safety and conflicting transit schedules retain their existing uncertainty labels. No new pantry facts or bus times were invented.

See [independent quality review](QUALITY-REVIEW.md) for observed accessibility/loading evidence. Browser tests use controlled AI/email/routing fixtures; they do not establish live external availability. No deployment or GitHub push was performed for this task.

## Final automated checks

- Data validation and TypeScript checks passed.
- 671 unit tests passed across 75 files. Removed tests exercised deleted provider-specific protocols; two new SMTP follow-up safeguards are covered.
- 84 distinct targeted Chromium cases passed in final runs/reruns: discovery 21; map/location 30; responsive/theme polish 12; preference cancellation 3; reviewed outreach 3; loading/accessibility 9; assistant flow 6. These cover phone, tablet and desktop; not the entire browser suite.
- Initial browser failures exposed stale navigation/text expectations and two loading accessibility defects. Those were corrected. An assistant run also lost its page to a development-server reload; its isolated rerun passed.
- Independent Luna reviewer ran the nine loading cases and captured pending/completed states at three widths. No serious/critical axe violations remained in the tested loading flow. Manual screen-reader/device testing remains outstanding.
- Dependency audit: zero reported vulnerabilities. No real message was sent and no new live AI/provider availability claim is made.
- Production build passed. Scanning `.next/static` found zero matches for available private credential values; `.env` and `.env.local` are untracked. This targeted scan is not a comprehensive security audit.
