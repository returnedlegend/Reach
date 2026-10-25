# Reach documentation

Start here to run Reach, understand its data, rehearse a demonstration, or maintain the application. The repository contains current setup guides alongside historical implementation and verification reports. A dated successful test describes that run; it does not establish that an external service is available today.

## Current release decision

Read the [food-first follow-up](FOOD-FIRST-RELEASE.md) and [its verification](FOOD-FIRST-VERIFICATION.md) for the current home flow, automatic feasibility checks, independent review fixes and provider limits. Older questionnaire walkthroughs below are historical.

Start with the [implemented first-release candidate](FIRST-RELEASE.md), its readiness table, maintenance process and current verification evidence. Earlier assessments below are dated history.

- [Executive readiness report](REACH-CEO-READINESS-REPORT.md): detailed feature assessment, implemented improvements, remaining repairs and release priorities.
- [Pantry recommendation](PANTRY-RECOMMENDATION.md): deterministic constraints, scoring, alternatives, comparison limits and a dated real routing example.
- [Publishing](PUBLISHING.md): tested single-host container, HTTPS configuration, persistent volume and WAL-safe backup/restore.
- [2026 competition requirements](CHALLENGE-REQUIREMENTS-2026.md) and [submission preparation](SUBMISSION-PREPARATION.md): official-source conflict, authorship/AI disclosure, video and entrant-owned actions.
- [Current test evidence](evidence/readiness-verification.json), [runtime provider state](evidence/runtime-readiness.json), and [container evidence](evidence/publication-verification.json): scoped checks rather than a public-service guarantee.

## Start and demonstrate

- [Development and maintenance](DEVELOPMENT.md): local setup, Windows and POSIX commands, test prerequisites, layout conventions, troubleshooting, and safe publishing.
- [Demonstration guide](DEMO.md): a three-minute real-directory journey, optional provider-dependent features, and the separately labeled fictional planner.
- [Final polish and alignment verification](FINAL-POLISH.md): implementation checklist, known launch limitations, test results, and before/after screenshots.
- [Student guide](STUDENT-GUIDE.md): project learning and explanation material.

- [Code review and regression findings](CODE-REVIEW.md): review scope, repaired defects, evidence and remaining external limits.

## Understand the application

| Area                              | Main guide                                                       | Supporting material                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Architecture and trust boundaries | [How Reach works](ARCHITECTURE.md)                               | [Access planner](ACCESS-PLANNER.md), [AI navigation](AI-NAVIGATION.md)                                                            |
| API routes and access boundaries  | [Route and access map](DEVELOPMENT.md#api-and-access-boundaries) | [Authentication](AUTHENTICATION.md), [Community](COMMUNITY.md)                                                                    |
| Pantry records and maintenance    | [Pantry database](PANTRY-DATABASE.md)                            | [Data sources](DATA-SOURCES.md), [TX-10 data](TX10-DATA.md), [Data review](DATA-REVIEW.md)                                        |
| Maps, search, and routing         | [OpenStreetMap providers](OPENSTREETMAP.md)                      | [Navigation providers](NAVIGATION-PROVIDERS.md), [GTFS](GTFS.md), [District boundary](TX10-BOUNDARY.md)                           |
| Assistant and AI configuration    | [DeepSeek AI setup](DEEPSEEK.md)                                 | [AI configuration](AI-CONFIGURATION.md), [AI assistance](AI-ASSISTANCE.md)                                                        |
| Accounts and identity             | [Authentication](AUTHENTICATION.md)                              | [Google sign-in](GOOGLE-SIGN-IN.md), [Account integration](ACCOUNT-INTEGRATION.md)                                                |
| Reviewed email and delivery       | [SMTP delivery](SMTP.md)                                              | [SMTP and AI setup](SMTP-AI-SETUP.md), [Access planner outreach](ACCESS-PLANNER.md)                                               |
| Community participation           | [Community](COMMUNITY.md)                                        | [Food-sharing safety](FOOD-SHARING-SAFETY.md), [Volunteer coordination](VOLUNTEER-COORDINATION.md)                                |
| Visual design and accessibility   | [DaisyUI design system](DAISY-DESIGN.md)                         | [DaisyUI verification](DAISY-VERIFICATION.md), [Alignment follow-up](FINAL-POLISH.md#follow-up-alignment-polish--october-23-2026) |

## Interpret evidence correctly

There are three distinct evidence levels:

1. **Deterministic fixtures and mocks** test validation, authorization, routing logic, and error behavior. They do not prove real pantry stock, actual delivery, or live provider availability.
2. **Real local application checks** exercise the running UI, public directory, database, and configuration endpoints. A configured status is not an inference or delivery test.
3. **Dated live observations** apply only to the service, credentials, request, and time recorded. For example, dated checks in [OpenRouter verification](FREE-OPENROUTER-VERIFICATION.md) describe an earlier provider configuration and do not establish current DeepSeek availability or account status, or current email delivery.

Screenshots under `evidence/` document rendering. Some tests deliberately neutralize external map tiles; such screenshots do not establish basemap service availability. Never publish screenshots containing precise private origins, account tokens, personal messages, or private preview links.

## Public launch prerequisites

Before public hosting, review canonical HTTPS origin configuration, persistent private SQLite storage and restore procedures, provider quotas and attribution, sender verification, moderation, and food-sharing safety. Verify pantry information directly before travel. Reach does not guarantee admission, inventory, accessible entrances, safe crossings, live transit positions, or a confirmed pickup arrangement.

Keep private runtime files, credentials, and local editor/chat state out of Git. See [development and maintenance](DEVELOPMENT.md#publish-changes-safely) for the publication checklist.
