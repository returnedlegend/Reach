# Reach documentation

Start here to run Reach, understand its data, rehearse a demonstration, or maintain the application. The repository contains current setup guides alongside historical implementation and verification reports. A dated successful test describes that run; it does not establish that an external service is available today.

## Start and demonstrate

- [Development and maintenance](DEVELOPMENT.md): local setup, Windows and POSIX commands, test prerequisites, layout conventions, troubleshooting, and safe publishing.
- [Demonstration guide](DEMO.md): a three-minute real-directory journey, optional provider-dependent features, and the separately labeled fictional planner.
- [Final polish and alignment verification](FINAL-POLISH.md): implementation checklist, known launch limitations, test results, and before/after screenshots.
- [Student guide](STUDENT-GUIDE.md): project learning and explanation material.

## Understand the application

| Area | Main guide | Supporting material |
| --- | --- | --- |
| Architecture and trust boundaries | [How Reach works](ARCHITECTURE.md) | [Access planner](ACCESS-PLANNER.md), [AI navigation](AI-NAVIGATION.md) |
| Pantry records and maintenance | [Pantry database](PANTRY-DATABASE.md) | [Data sources](DATA-SOURCES.md), [TX-10 data](TX10-DATA.md), [Data review](DATA-REVIEW.md) |
| Maps, search, and routing | [OpenStreetMap providers](OPENSTREETMAP.md) | [Navigation providers](NAVIGATION-PROVIDERS.md), [GTFS](GTFS.md), [District boundary](TX10-BOUNDARY.md) |
| Assistant and AI configuration | [Free OpenRouter setup](FREE-OPENROUTER.md) | [AI configuration](AI-CONFIGURATION.md), [AI assistance](AI-ASSISTANCE.md) |
| Accounts and identity | [Authentication](AUTHENTICATION.md) | [Google sign-in](GOOGLE-SIGN-IN.md), [Account integration](ACCOUNT-INTEGRATION.md) |
| Reviewed email and delivery | [Resend](RESEND.md) | [SMTP and AI setup](SMTP-AI-SETUP.md), [Access planner outreach](ACCESS-PLANNER.md) |
| Community participation | [Community](COMMUNITY.md) | [Food-sharing safety](FOOD-SHARING-SAFETY.md), [Volunteer coordination](VOLUNTEER-COORDINATION.md) |
| Visual design and accessibility | [DaisyUI design system](DAISY-DESIGN.md) | [DaisyUI verification](DAISY-VERIFICATION.md), [Alignment follow-up](FINAL-POLISH.md#follow-up-alignment-polish--october-23-2026) |

## Interpret evidence correctly

There are three distinct evidence levels:

1. **Deterministic fixtures and mocks** test validation, authorization, routing logic, and error behavior. They do not prove real pantry stock, actual delivery, or live provider availability.
2. **Real local application checks** exercise the running UI, public directory, database, and configuration endpoints. A configured status is not an inference or delivery test.
3. **Dated live observations** apply only to the service, credentials, request, and time recorded. For example, the supplied-credential follow-up in [OpenRouter verification](FREE-OPENROUTER-VERIFICATION.md#follow-up-supplied-credentials-october-24-2026-utc) is separate from that report's earlier credential-free fixture review. It does not establish Resend delivery.

Screenshots under `evidence/` document rendering. Some tests deliberately neutralize external map tiles; such screenshots do not establish basemap service availability. Never publish screenshots containing precise private origins, account tokens, personal messages, or private preview links.

## Public launch prerequisites

Before public hosting, review canonical HTTPS origin configuration, persistent private SQLite storage and restore procedures, provider quotas and attribution, sender verification, moderation, and food-sharing safety. Verify pantry information directly before travel. Reach does not guarantee admission, inventory, accessible entrances, safe crossings, live transit positions, or a confirmed pickup arrangement.

Keep private runtime files, credentials, and local editor/chat state out of Git. See [development and maintenance](DEVELOPMENT.md#publish-changes-safely) for the publication checklist.
