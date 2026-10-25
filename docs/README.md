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

## Interpret evidence correctly

There are three distinct evidence levels:

Screenshots under `evidence/` document rendering. Some tests deliberately neutralize external map tiles; such screenshots do not establish basemap service availability. Never publish screenshots containing precise private origins, account tokens, personal messages, or private preview links.

## Public launch prerequisites

Before public hosting, review canonical HTTPS origin configuration, persistent private SQLite storage and restore procedures, provider quotas and attribution, sender verification, moderation, and food-sharing safety. Verify pantry information directly before travel. Reach does not guarantee admission, inventory, accessible entrances, safe crossings, live transit positions, or a confirmed pickup arrangement.

Keep private runtime files, credentials, and local editor/chat state out of Git. See [development and maintenance](DEVELOPMENT.md#publish-changes-safely) for the publication checklist.
