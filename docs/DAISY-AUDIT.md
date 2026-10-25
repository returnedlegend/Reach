# Reach daisyUI redesign audit

This is the **pre-redesign inventory**. For the completed implementation, see
[the daisyUI design system](DAISY-DESIGN.md) and [independent verification](DAISY-VERIFICATION.md).

Audit scope: current application structure and presentation, to guide the in-progress mobile-first daisyUI redesign. No application logic or dependencies were changed for this audit.

## Stack and migration fit

- Next.js 16.4.2 App Router, React 19.3.1, TypeScript, Node 24. The current package has no Tailwind, daisyUI, or PostCSS dependency/configuration. Presentation is authored in plain CSS and one CSS module.
- The migration is a greenfield CSS-pipeline addition, not an existing Tailwind upgrade. Keep it incremental: install the Tailwind 4 PostCSS integration and daisyUI 5, add the documented PostCSS plugin, and add `@import "tailwindcss"` plus `@plugin "daisyui"` in the app stylesheet. Preserve existing CSS while the markup is converted; remove superseded rules page by page.
- daisyUI's current official docs identify release 5.7.50 and show the Next.js install above. Their theme docs support custom themes declared in CSS. Define only `reach` and `reach-dark`, map semantic tokens to the Reach palette, and set the root `data-theme` deliberately. The current document has no theme selection or persistence behavior.
- Tailwind's current Next.js guide uses the v4 CSS-first/PostCSS setup. Keep PostCSS configuration minimal and avoid adding a JS Tailwind config unless a concrete need appears. Check the installed Next 16 docs under `node_modules/next/dist/docs/` when touching framework APIs.

## Route and capability inventory

### Implemented user-facing routes

| Route | Current implementation | Scope and notes |
| --- | --- | --- |
| `/` | `GuidedReach` with the live public directory | Main discovery flow, location input/geolocation, need selection, pantry and food-resource results, route planning, map/list results, saved trips, pantry details, and a `CommunityPanel` entry point. Existing public pantry directory and server-backed resource data are used. |
| `/food-hotspots` | `GuidedReach` with `initialHotspots` | Community food sharing / hotspot mode on the shared guided experience. The component includes browsing and contribution/moderation paths backed by community APIs. |
| `/pantry-planner` | `ReachApp` | Separate, older detailed trip planner with transit/walking options, saved plans, pantry sources, and detail dialog. This route is currently the only consumer of `ReachApp`; preserve it unless product scope explicitly retires it. |
| `/pantries/[id]` | `PantryDetail` | Individual pantry information, schedule, directions, crowd/busy-time observations, and community reports where available. |
| `/manage` | `PantryManagement` | Pantry correction/management workflow. |
| `/volunteer` | `VolunteerPanel` | Volunteer pickup and redistribution coordination. Requires account-specific access for private instructions. |
| `/account` | `AccountPanel` | Sign-in/account creation and verification, preferences, saved resources, location consent, notification settings, and account management. |
| `/unsubscribe` | `UnsubscribePanel` | Email preference/unsubscribe flow. |
| `/privacy`, `/terms` | Static content pages | Privacy/location/data disclosures and service terms. |

At the time of this original audit, the repository implemented API routes for coverage, pantry directory and management, plans, journey/geocoding/reverse geocoding, crowd observations, notifications, the Postal webhook, volunteer, community, and account operations under `src/app/api`. The redesign was to leave their contracts and backend untouched. The historical webhook integration has since been retired; current email uses SMTP or private preview.

### Planned versus operational claims

The brief's high-level concepts are not all uniformly live. The map, location search, route calculation, pantry details, source-backed regional directory, community listings, volunteer flow, accounts, notifications, and crowd observations have implementations. Some of those depend on provider configuration, record coverage, permissions, or account role and can legitimately show empty/unavailable states. “Texas 10th district / Austin expansion” is described as growing coverage, not evidence of a fully populated region. Do not imply universal coverage, confirmed pantry inventory, verified live transit, or reliable busy-time predictions. Existing interfaces already use source labels, confidence/caveat copy, community-submitted labels, and empty states; retain those distinctions.

## Current design and CSS findings

- There are two separate discovery UIs: modern `GuidedReach` at `/` and older `ReachApp` at `/pantry-planner`. `src/app/globals.css` is about 3,300 lines and contains both UI systems plus older `.guided` styles. `src/app/design-system.css` then redefines global foundations and applies further compatibility overrides. This makes cascade order part of the design and makes a broad rewrite high risk.
- Both global stylesheets declare `:root` colors and `body` typography/background. `globals.css` uses a serif 57px `h1`, 15px Arial, and an earlier palette; later `design-system.css` replaces the body palette/font but only selectively resets heading styles. Root `h1` rules continue to affect page content outside more specific selectors.
- CSS is split across global `globals.css`, global `design-system.css`, `guided-reach.module.css`, and page/component stylesheets for account, pantry, volunteer, community, notifications, plus MapLibre's stylesheet. Several component sheets are imported by components and participate globally. They scope most selectors, but still bake in independent colors and control styles. In particular `.community-panel` owns its own ink/green/paper values; `.pantry-page` uses a parallel `--pantry-*` token set; account and volunteer styles each define component-specific button and focus treatments. This will make theme switching incomplete until these local variables and literal colors are mapped to semantic tokens.
- `design-system.css` contains route detection and layout overrides using `body:has([data-secondary-nav])`, including hiding older headers, inserting mobile bottom padding, and restyling `/pantry-planner`'s `.page-shell`/`.guided` elements. These selectors couple page layout to the presence of the shared nav, and the root layout conditionally suppresses that nav on `/` and `/food-hotspots`. Preserve this behavior intentionally while consolidating shared navigation.
- `/` and `/food-hotspots` have the root `SiteNavigation` hidden because `GuidedReach` renders its own header/bottom navigation. Supporting pages use the shared responsive header and bottom nav. Avoid double navigation during integration; choose one owner per route.
- There is no Tailwind or daisyUI today, so daisy classes currently have no generated styles. The safest starting surface is the shared navigation and reusable controls/cards, with route-specific functional shells intact.
- Existing good foundations worth keeping: focus-visible outlines, labels and live status/error regions, 44px+ control targets in supporting flows, reduced-noise mobile sheet in `GuidedReach`, safe-area padding for its bottom nav, and explicit source/availability caveats. These should be checked as styles are replaced, since daisyUI defaults alone do not ensure WCAG contrast or correct dialog semantics.

## Smallest safe migration sequence

1. Add the official Tailwind 4 PostCSS and daisyUI 5 pipeline; retain both existing stylesheets initially. Configure only the two requested custom themes (`reach`, `reach-dark`) and semantic color/radius tokens. Establish a deliberate light default and a dark-theme mechanism that does not change saved-trip/account logic.
2. Convert shared navigation and common button/input/badge/card primitives first. Keep existing component APIs and event handlers; replace presentation classes without moving business logic. Make nav ownership explicit for main discovery versus supporting routes.
3. Migrate `GuidedReach` and its map/sheet as the primary redesign. Preserve MapLibre, route sources, location permissions, lists, and route/direction behavior. Its `guided-reach.module.css` is a focused override surface; coordinate map height, sheet scrolling, and bottom navigation with the existing CSS.
4. Convert secondary surfaces in this order: `/food-hotspots` community views; `/pantries/[id]`, `/manage`, and `/volunteer` pantry-scoped views; `/account` and `/unsubscribe`; static legal pages; `/pantry-planner`'s legacy planner. Map local CSS variables and literal colors to semantic tokens as each surface moves.
5. Delete obsolete selectors only after their owning route is migrated. In particular, do not remove `ReachApp`/planner styling solely because `/` now uses `GuidedReach`. Keep MapLibre CSS and CSS-module sheet/layout rules until their replacements are verified.

This sequence changes presentation in small route-sized increments and leaves data, APIs, auth, geolocation, map providers, and routing architecture in place.

## Official references consulted

- daisyUI 5 Next.js install: https://daisyui.com/docs/install/nextjs/ — current page shows daisyUI 5.7.50 and the `tailwindcss`, `@tailwindcss/postcss`, `daisyui@latest` install; PostCSS plugin plus CSS `@import "tailwindcss"` / `@plugin "daisyui"`.
- daisyUI themes: https://daisyui.com/docs/themes/ — custom themes and theme declarations live in CSS; `data-theme` selects a theme; theme tokens provide semantic colors.
- Tailwind CSS Next.js guide: https://tailwindcss.com/docs/guides/nextjs — current v4 Next.js/PostCSS setup.

References fetched 2026-10-22. Framework versions and upstream documentation may change before implementation.
