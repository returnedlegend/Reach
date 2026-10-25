# Reach mobile interface redesign

Redesign checked October 20, 2026 (America/Chicago). The existing Next.js/React
application and plain-CSS architecture are retained. No dependencies, data
records, authentication rules, transit schedules or routing providers were added
or replaced for the redesign.

## Changes

- Shared forest-green, sage and warm-white design tokens, system sans-serif
  typography, restrained surfaces, consistent form controls, focus states and
  reduced-motion support.
- Real homepage address/GPS search reuses the existing location picker. Local
  suggestions and external searches preserve their explicit-submit behavior;
  the food action keeps the selected coordinates and guided travel choices.
- A map resource sheet supports touch swipes, a keyboard-accessible toggle,
  collapsible filters, scrolling listings and synchronized selected previews.
  It stays in the document layout so provider attribution remains available.
- Pantry details prioritize address, distribution windows, availability and
  directions. Registration requirements stay separate from distribution hours;
  eligibility, accessibility and sources remain accessible in disclosures.
- Supporting pages share responsive navigation with active-page indicators,
  a keyboard-operable More disclosure and mobile bottom navigation. Account,
  management, food-sharing, volunteering, legal pages and the retained detailed
  planner use the same visual language.
- Loading skeletons, readable empty/error states, 44px primary touch targets and
  mobile scroll clearance for fixed navigation. No automatic location request.

## Important files

| Files | Purpose |
| --- | --- |
| `src/app/design-system.css`, `src/app/layout.tsx` | Shared tokens, responsive controls, navigation, reduced motion and print integration |
| `src/components/site-navigation.tsx`, `loading-state.tsx` | Reusable supporting-page navigation and loading feedback |
| `src/components/guided-reach.tsx`, `guided-reach.module.css` | Homepage, results, resource sheet and mobile discovery |
| `src/components/location-picker.tsx` | Presentation-only compact picker; coordinate and provider logic retained |
| `src/components/pantry-detail.tsx`, `pantry-pages.css` | Detail hierarchy and consistent pantry/management styling |
| `src/components/account-panel.tsx`, `volunteer-panel.tsx` | Clearer headings and account loading feedback |
| `src/components/reach-app.tsx` | Retained planner navigation labeled separately from shared site navigation |
| `tests/redesign-review.spec.ts` | Independent mobile, accessibility, navigation and touch-sheet checks |
| `tests/account-verification.spec.ts`, `email-ui.spec.ts`, `pantry-ui.spec.ts` | Updated intentional heading expectations and a deterministic Monday clock for the existing schedule fixture |
| `tests/workflow.spec.ts` | Existing download/save/print checks now also guard actual mobile viewport bounds after saving |
| `tests/transformation.spec.ts` | GPS/map/filter journeys explicitly open the new filter disclosure before using its controls |

## Verification

The pre-redesign `npm run check` passed data validation, TypeScript, 295 unit
tests in 23 files and the production build. The post-redesign check also passed
those checks. Data validation, TypeScript and all 295 unit tests passed again
after the navigation changes; subsequent CSS fixes were built again before
production browser verification. See [unit output](evidence/redesign-unit.txt)
and [production build output](evidence/redesign-build.txt). There is no lint script configured.

Independent visual review covers nine settled routes across 320, 390, 412,
820 and 1280px widths. A corrected physical-width audit independently passed
all 27 route/width combinations at 320, 390 and 412px, with page, viewport and
fixed-navigation dimensions agreeing. See [measured widths](evidence/redesign-physical-widths.json). See [design/mobile review](REDESIGN-REVIEW.md)
and [functional report](REDESIGN-FUNCTIONAL.md) for exact executed checks and
remaining boundaries. The final clean production run passed **317 browser checks**, with **7 intentional
skips and no failures**, across phone 390×844, Android-sized 412×915, tablet
820×1180 and desktop 1280×900 Chromium. It executed the corrected physical-width
checks, the touch/keyboard resource-sheet checks and the retained real account,
community, saved-trip, download and print workflows. The 7 skips are four
preview-only email lifecycles on the deliberately email-disabled production
server, plus the 320px batch omitted on three duplicate profiles. This is 81
cases per profile, not 324 independent journeys. See the [complete browser
output](evidence/redesign-browser.txt) and [focused planner evidence](evidence/redesign-planner.txt).

The review found and prompted fixes for small targets, missing heading structure,
logo compression, overly dense map filters, split card-action labels and fixed
navigation intercepting a busy-times pointer click. The shared shell initially
hid retained planner tabs; those working controls were restored with a distinct
planner-navigation landmark before final testing. The existing schedule test
now uses its intended Monday explicitly instead of depending on the actual day.
Its behavior assertions were retained. Modal controls are excluded from the fixed-navigation scroll margin, and phone trip actions use a two-row layout so the saved label cannot widen the viewport or disrupt a download tap. A legacy phone navigation order rule also conflicted with the new planner grid; explicit grid placement and ordering now keep the tabs in the wide column. Physical-width assertions guard against Chromium shrinking a wider layout to fit the phone.

## Visual evidence

- [Mobile food search](evidence/redesign-mobile-home.png)
- [Mobile map and resource sheet](evidence/redesign-mobile-map.png)
- [Mobile pantry details](evidence/redesign-mobile-pantry.png)
- [Mobile account](evidence/redesign-mobile-account.png)
- [Desktop food search](evidence/redesign-desktop-home.png)
- [Desktop map](evidence/redesign-desktop-map.png)

Map screenshots use real MapLibre markers with a controlled neutral background
for reproducible layout review. They do not verify external cartography, route
suitability or provider uptime. Pantry/source content is real local application
data; no food inventory, hours, crowd observations or live transit were invented.

## Run locally

Use Node 24, then `npm ci` and `npm run dev`. The development launcher uses
Webpack; the community pilot is now off by default. Use `npm run dev:community`
only for an explicit local pilot session. For production checks, run
`npm run check`, then `npm start`; community requires its explicit production
flag. Do not rebuild beneath an active production test server.

Mapping/search setup remains in [OpenStreetMap configuration](OPENSTREETMAP.md).
Email remained in private local-preview mode during this historical redesign; see
[current mail setup](SMTP.md). No real email or public deployment was part of
that work.
Physical-device testing and manual screen-reader testing remain unperformed.
