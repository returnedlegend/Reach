# Reach · daisyUI design system

Implemented October 21, 2026 (America/Chicago; October 22 UTC). This continues
the existing application. The earlier [mobile redesign report](UI-REDESIGN.md)
describes its previous appearance; [independent daisyUI verification](DAISY-VERIFICATION.md)
records the current acceptance checks.

## Experience

- Compact shared navigation, a mobile daisyUI dock, and an accessible More
  disclosure keep food discovery, food sharing, accounts, volunteering and the
  detailed planner reachable. Menus close on navigation and Escape restores focus.
- The question-first flow, search and optional filters remain. Food cards use
  daisyUI surfaces, verification badges, readable distribution summaries and two
  distinct actions for details and directions. Reset filters preserves the
  selected origin and destination.
- The interactive map now appears before its controls and explanatory text.
  Existing marker/list selection, map/list switching, mobile resource sheet,
  walking/driving modes, route instructions and provider-failure states remain.
  Human-readable directions headings lead; routing provenance is available in
  an expandable source section.
- Pantry details, account forms, pantry management, community sharing,
  volunteering, notification preferences, busy-time displays and the retained
  detailed planner share semantic colors and daisyUI controls. Unknown inventory,
  hours, accessibility and route availability retain their existing labels.
- Account, community and management tabs use daisyUI's actual `tab-active`
  state. Selected tabs, planner choices and busy-time weekdays have a contrasting
  fill and underline, so current choices remain visible without relying on color.
- Light and dark themes follow the operating system until the user makes an
  explicit choice. A small, non-sensitive appearance preference is saved when
  browser storage permits. The initial theme is applied before hydration;
  blocked storage leaves the control usable in memory during client navigation.

No database schema, pantry record, eligibility rule, authentication permission,
API contract, geolocation request, route calculation or transit calendar changed
for this redesign. Saved itineraries, consent, text downloads and print remain
in their existing implementations. No unsupported inventory or transport filters
were enabled.

## Dependencies and CSS architecture

The project previously had no Tailwind dependency. It now uses the official
Tailwind 4 PostCSS integration and daisyUI 5 CSS plugins, pinned in the lockfile:

| Package | Version | Role |
| --- | --- | --- |
| `daisyui` | 5.7.50 | Component and custom-theme generation |
| `tailwindcss` | 4.3.3 | Utilities and CSS-first configuration |
| `@tailwindcss/postcss` | 4.3.3 | Build integration |

These are build dependencies. Existing React, Next.js, MapLibre and Lucide
versions were retained. No second component library or remote font was added.
The font stack prefers Inter when already available, then native system fonts.

`src/app/reach-theme.css` is the only root application stylesheet entry. It
declares the cascade order, imports Tailwind, configures two custom daisyUI
themes and imports the preserved global layouts into a `legacy` layer. The
supporting component styles use that same layer. MapLibre CSS remains lazy-loaded
inside a lower `vendor` layer so it cannot shrink Reach's 44px map controls.
Actual daisyUI `navbar`,
`dock`, `dropdown`, `menu`, `card`, `btn`, `badge`, `tabs`, `input`, `select`,
`checkbox`, `loading` and `skeleton` classes supply shared components. Existing
native dialogs and functional sheet controls were retained rather than replaced
with a second state mechanism.

`reach-polish.css` is the final integration layer. It maps legacy layout tokens
to daisyUI semantic colors, applies spacing, touch targets, safe-area padding,
focus treatment and responsive refinements. The discovery CSS module retains
its functional layout with semantic colors. Older layout rules were deliberately
retained where needed by the separate detailed planner; they should only be
removed with route-level regression evidence.

Reusable React primitives are `Surface`, `ActionButton`, `LoadingState`,
`ThemeToggle` and `MoreMenu`. They preserve native element semantics and share
presentation without duplicating business logic.

## Important files

| Files | Purpose |
| --- | --- |
| `postcss.config.mjs`, `package.json`, `package-lock.json` | Official Tailwind/daisyUI build setup |
| `src/app/reach-theme.css`, `reach-polish.css`, `layout.tsx` | Theme definitions, cascade, responsive polish and early theme initialization |
| `src/app/globals.css`, `design-system.css` | Preserved layouts converted to semantic colors |
| `src/components/ui.tsx`, `theme-toggle.tsx`, `site-navigation.tsx`, `loading-state.tsx`, `src/lib/theme.ts` | Shared controls, navigation and appearance preference |
| `src/components/guided-reach.tsx`, `guided-reach.module.css` | Question flow, cards, filters, directions hierarchy and responsive actions |
| `src/components/journey-map.tsx`, `osm-map-canvas.tsx`, `osm-map-canvas.css` | Map-first presentation and lazy provider stylesheet isolation |
| `src/components/location-picker.tsx`, `reach-app.tsx` | Existing location and detailed-planner controls using daisyUI |
| `src/components/account-panel*`, `pantry-detail.tsx`, `pantry-management.tsx`, `pantry-pages.css`, `community-panel*`, `volunteer-panel*`, `notification-preferences*`, `busy-times.tsx` | Supporting-page forms, cards and semantic states |
| `tests/daisy-verification.spec.ts`, `email-ui.spec.ts` | Independent theme/responsive/accessibility coverage and updated mobile-menu navigation assertion |

## Theme contract

| Token | Light `reach` | Dark `reach-dark` |
| --- | --- | --- |
| Primary / content | `#0F766E` / white | `#5EEAD4` / `#042F2E` |
| Page background | `#F8FAFC` | `#0C161E` |
| Surface | white | `#15232D` |
| Primary text | `#0F172A` | `#EDF5FA` |
| Accent | `#F59E0B` | `#FBBF24` |

Status colors have separate foreground and solid-fill content tokens. Tinted
notices use the status foreground; solid buttons use their matching content
color. Inline prose links are underlined, and state labels do not depend on color
alone. Keyboard focus is visible, primary controls have at least 44px targets,
and editable field/unchecked checkbox outlines use a stronger control token
separate from decorative card borders. Existing reduced-motion support remains.
Theme changes are applied atomically
to avoid transient low-contrast intermediate color pairs; ordinary control
transitions retain short shadow, press and opacity feedback and respect reduced
motion. Button/tab foreground and background changes are also atomic, so
switching a selected state cannot briefly mix an unreadable color pair.

The underlying cartography keeps its configured provider style, including in
dark mode. This is an application theme, not a claim of newly added dark map
tiles. MapLibre controls and route distinctions remain available with textual
alternatives. Initial map mounting with a precomputed route can center on the
origin rather than fitting the entire route; users can zoom out. That existing
camera behavior was not changed during this presentation work.

## Run and verify

Use Node 24:

```bash
npm ci
npm run dev
```

```bash
npm run check
npm run test:e2e
```

`check` validates the 24 maintained food-site records, TypeScript, unit tests and
the production build. No lint script is configured. The browser suite supports
`REACH_TEST_URL` for an already-running isolated server. Its full account and
community coverage requires explicit test configuration; do not treat skipped
email-delivery checks as passed. Do not rebuild beneath an active production
test server.

The fresh pre-change baseline and final check both passed 313 unit tests in 27
files, data validation, TypeScript and the production build. See the independent
report for final browser counts, exact viewport evidence, defects found and
corrected, screenshot links and remaining test boundaries. Automated axe checks
and keyboard tests are evidence for the tested states, not a blanket WCAG
certification. Physical phones and manual screen-reader sessions remain untested.

The clean final production run passed **417 browser checks**, with **seven
intentional skips and no failures** out of 424 cases across four Chromium
profiles. The added UI checks produced [108 route screenshots](evidence/daisy-screenshots.json) at 320, 375, 390,
768, 1024 and 1440px, and performed 48 tagged axe scans. Measurements separately
cover [32 control-boundary samples](evidence/daisy-control-contrast.json) and
[72 selected-state samples](evidence/daisy-selected-states.json), including
ordinary-motion selection changes. See [the complete browser output](evidence/daisy-browser.txt).

Representative final screenshots:

- [Phone · light](evidence/daisy-mobile-home-light.png) and [dark](evidence/daisy-mobile-home-dark.png)
- [Phone · account](evidence/daisy-mobile-account-dark.png) and [pantry details](evidence/daisy-mobile-pantry-dark.png)
- [Desktop · light](evidence/daisy-desktop-home-light.png) and [dark](evidence/daisy-desktop-home-dark.png)
- [Phone map · light](evidence/daisy-map-mobile-light.png) and [dark](evidence/daisy-map-mobile-dark.png)
- [Desktop map · light](evidence/daisy-map-desktop-light.png) and [dark](evidence/daisy-map-desktop-dark.png)

The map pictures use a neutral background and explicitly labeled browser-only
route fixtures. They show UI/marker/geometry behavior, not live cartography,
measured routes or safe travel advice. The [capture manifest](evidence/daisy-map-fixtures.json)
records the requested endpoints, viewport sizes and absence of runtime errors.
The independent report covers their limits. Older [mobile](evidence/redesign-mobile-home.png)
and [desktop](evidence/redesign-desktop-home.png) images show the previous design.

No external provider integration was newly verified by this presentation task.
Controlled maps, routes, geolocation and email fixtures must not be confused
with live services. Existing SQLite and public-provider deployment limitations
also remain; this redesign does not establish capacity for thousands of users.

## Official references

- [daisyUI Next.js installation](https://daisyui.com/docs/install/nextjs/)
- [daisyUI custom themes](https://daisyui.com/docs/themes/)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/guides/nextjs)
- [WCAG 2.2 non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

The implementation used the official packages and documentation. The requested
daisyUI plugin was not available among this environment's installed tools or
skills, so no plugin invocation is claimed. See [the initial audit](DAISY-AUDIT.md)
for the route inventory and compatibility findings.

Two explicitly selected GPT-6-Luna agents at high reasoning handled the bounded
repository/design audit and supporting-page presentation work, with separate
file ownership. The main agent owned the design system, discovery/map integration
and fixes. A separate reviewer independently inspected source, ran browsers,
reported defects and rechecked corrections. No token or dollar accounting was
available, so no measured compute-saving claim is made.
