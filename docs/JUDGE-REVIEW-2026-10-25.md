# Reach: judge-style review and engineering response

This is a simulated judging assessment, not an official Congressional App Challenge
score or eligibility determination. Reviewed October 25, 2026 against the current
repository and a running production build. No public deployment was performed.

## Verdict

Reach addresses a meaningful problem, and its account-free food discovery and
moderated community listings are a credible foundation. It is not yet demonstrated
as a dependable way to obtain food. A directory match, an attractive map, and an AI
summary do not establish that a person can reach a pickup, qualifies, or will receive
food. The strongest competition story is the careful handling of those constraints,
not the number of features or use of an AI brand.

| Judging lens | Criticism and evidence | Response |
| --- | --- | --- |
| Practical usefulness | Before selecting a location, cards said “Distance-and-pickup match” despite having no distance measurement. The general context also hid coverage information behind a travel-status sentence. | Cards now say “Directory suggestion” without an origin. The results explain the searched area, missing distance, and unchecked travel. |
| Reliability | A response containing only an obsolete ID left valid matches out of the displayed cards. Duplicate/partial IDs could reduce the comparison to fewer options. Browser regressions reproduced both failures before changes. | Reconcile rankings against the current matches, deduplicate IDs, and fill remaining slots from the deterministic ranking. Never invent matches to reach three. Hide an empty/stale AI summary panel. |
| Community usefulness | Directory-only search did not refresh server-provided resources; refresh was inside the AI branch. Someone could miss a newly approved hotspot until a page reload. | Every search refreshes the directory. A browser test inserts an approved synthetic hotspot after loading the page and finds it with AI switched off. |
| Mobile clarity | The first screen repeated the sharing action already available in the header, pushing the food task farther down the page. | Removed the duplicate promotional block. The prominent header Share food action and community entry points remain. |
| Technical substance | The discovery score uses explicit distance, schedule and evidence weights. Those weights are heuristics, not a validated prediction of successful food pickup. A straight-line score cannot establish walkability or public-transit feasibility. | Keep discovery and checked-trip claims separate. Validate weights with real outcomes before making stronger effectiveness claims. No invented routes or availability were introduced. |
| Originality and ownership | A useful combination of features is not sufficient evidence of original student technical work. The development history contains substantial AI assistance. | Entrants must document their actual contributions and explain the ranking, failure handling and privacy boundaries themselves. Do not claim wholly student-written code. |
| Evidence of impact | No new interviews, pantry partnerships, user outcomes or field accessibility checks were established by this review. | Run a small consent-based usability pilot and verify pickup details with authoritative sources. Record completion rate, incorrect suggestions and time to a usable choice. Do not invent beneficiaries or success metrics. |

## What was exercised

The review used actual Chromium at phone and desktop sizes, a production Next.js
build, isolated SQLite records, and controlled AI responses. The baseline had
657 passing unit tests. Three newly written mobile assertions failed before fixes:
stale ranking IDs, duplicate ranking IDs, and no-origin recommendation wording.

After fixes, 659 unit tests across 79 files passed, as did TypeScript, data
validation and production build. The targeted browser suite covers ranking
fallbacks, newly approved directory entries without AI, discovery, protected
moderation/photos, and administrator session/password behavior. All 26 browser checks passed. Six initial-page WCAG A/AA scans found no automated
violations, horizontal overflow or failed application assets. These cover home,
sharing and admin sign-in at both sizes. See [recorded evidence](evidence/judge-review-2026-10-25/results.json).

AI-response fixtures test error handling; they are not successful live Groq calls.
A temporary test database does not prove production hosting, backups, delivery of
food, accessible entrances, or actual route accuracy. Automated accessibility scans
are useful evidence, not accessibility certification or a substitute for user tests.

## Before presenting to judges

1. Rehearse one real, short journey: choose a starting point, compare three actual
   options, explain a requirement, and open directions. Demonstrate the fallback
   when AI is unavailable. Only show retrieved route distances as routed distances.
2. Explain the algorithm from the source: the origin of each fact, scoring weights,
   missing-data handling, and why a nearby closed or unsuitable pantry may not help.
3. Keep availability claims cautious. Approval of community content is not food-safety
   inspection, stock verification, or authentication of the submitter's identity.
4. Verify the required external services on the installation used for the demo.
   This review did not exercise live Groq inference or certify a routing provider.
5. Complete the real contribution/AI disclosure and eligibility checks described in
   [submission preparation](SUBMISSION-PREPARATION.md). Consult the official portal
   for current rules and deadlines; this review did not revalidate the older rules
   research or resolve its documented deadline conflict.

These remaining items need operator configuration, field evidence, or entrant
input. They cannot honestly be marked fixed by additional UI code or unit tests.

Rendered home screens inspected after the changes:
[mobile](evidence/judge-review-2026-10-25/mobile.png) ·
[desktop](evidence/judge-review-2026-10-25/desktop.png).
