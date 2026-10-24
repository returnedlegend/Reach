# Independent redesign review

Reviewed locally in Chromium on October 20, 2026 (America/Chicago; October 21 UTC). This review made no application implementation edits, real accounts, email requests, or public deployment.

## Coverage and evidence

The nine public routes `/`, `/account`, `/volunteer`, `/food-hotspots`, `/pantry-planner`, `/manage`, `/privacy`, `/terms`, and `/pantries/bridge-ministries` were independently visited at **320, 390, 412, 820, and 1280px**. The original 45 settled route/viewport measurements compared document width with browser `innerWidth`; those results establish only document-relative fit. They do **not** establish physical viewport fit, because mobile Chromium can inflate `innerWidth` when content overflows. The browser helper now compares maximum document/body scroll width directly with Playwright's configured viewport width plus a 1px rounding allowance.

After the planner navigation layout fix, a fresh **27-case physical-width audit passed**: all nine settled routes at 320, 390, and 412px in Chromium mobile/touch contexts with an Android user agent. In every case, configured viewport width, `innerWidth`, document client width, document scroll width and body scroll width were identical. Visible header and fixed bottom-navigation bounds also stayed within the configured physical width. The corrected planner browser test passed at both 390px and 412px; the 390px axe check remained clear. This audit covers the public initial route states, while interactive modal/download paths are checked separately by functional QA. The 820px and 1280px findings above remain document-relative measurements. Loading headings were explicitly excluded from the route audit; the pantry page showed **The Bridge Ministries Bryan**, and management showed its signed-out state.

Screenshots reviewed include the homepage, account, real pantry detail, and map at mobile and desktop widths. Selected evidence:

- [Mobile home](evidence/redesign-mobile-home.png)
- [Desktop home](evidence/redesign-desktop-home.png)
- [Mobile map](evidence/redesign-mobile-map.png)
- [Desktop map](evidence/redesign-desktop-map.png)
- [Mobile pantry detail](evidence/redesign-mobile-pantry.png)
- [Mobile account](evidence/redesign-mobile-account.png)

The map images render real MapLibre controls and application pantry markers against an explicitly controlled neutral background. They verify layout and interaction, **not street cartography, tile-provider availability, directions accuracy, or live food availability**. Other public-route content came from the actual local application. Account screenshots show the local preview-mode notice; the review did not send or generate email.

An attempted before capture coincided with an intermediate missing CSS-module build and is invalid as a visual baseline. It is not presented as before/after evidence. Working audit JSON and the complete screenshot sweep are under `/tmp/reach-redesign-review`.

## Verified behavior

`tests/redesign-review.spec.ts` adds 16 focused browser checks. Before correcting the overflow helper, the 15 ordinary mobile checks passed, and the dedicated 320px nine-route batch passed in a separate rerun; these passes do not certify physical-width fit. That batch originally exceeded the shared 45-second default while navigating nine routes; its explicit timeout is now 120 seconds. No product expectation was removed, and the overflow expectation now uses the stricter configured physical width.

The checks cover:

- One visible main heading and main landmark on every route, after loading settles.
- No horizontal overflow at configured viewports and a separate 320px pass.
- No axe-detected WCAG A/AA violations on all nine settled mobile routes.
- Native account field labels, autocomplete, password constraints, responsive targets, and invalid-form prevention. Account availability is a synthetic fixture; no account is created.
- Keyboard operation of bottom navigation, current-page state, and secondary navigation; Escape closes More and returns focus.
- Keyboard Enter/Space and actual trusted CDP touch swipes on the resource-sheet handle, including expanded state, hidden content, and pointer/click suppression behavior. The same check verifies two mobile action columns and measures the actual Directions text range to ensure it stays on one visible, unclipped line.
- A complete food journey using the real local Bridge listing, keyboard selection, selected transport preservation, and results. Only the journey response is controlled.
- Reduced-motion animated scrolling and decorative-animation checks across discovery, account, and volunteer routes.

The production browser suite is run separately by the functional reviewer; this document does not claim its result in advance.

## Findings and resolution

The audit found and reported missing route-level heading structure on food sharing, undersized standalone footer/directory/legal-back links, narrow-phone brand compression, and mobile map filters consuming almost the full sheet before the first resource. The implementation now supplies the food-sharing h1, generous standalone targets, a stable brand mark, and a collapsed **Filter resources** disclosure in the map sheet. The original full explorer filter layout remains available on its own screen.

The forest-green controls, warm background, consistent spacing and form labels read coherently across discovery and supporting pages. At 320px the page remains readable and its primary action is reachable without horizontal scrolling. Forms and navigation wrap within the viewport. Pantry information separates hours, food availability, busy-time uncertainty, and directions into clearly labeled sections.

The final map capture also exposed fragmented action labels inside the narrow mobile sheet. This is now resolved and independently verified at both 320px and 390px: actions use two columns, all four labels stay on one line without clipping, and every action is 46px high. The focused map-sheet regression passed again after this fix, and the mobile map evidence above was replaced with the corrected capture.

Remaining minor observations: links embedded within legal/account prose and pantry source text remain smaller; these are inline-link target-size exceptions rather than failed primary controls. Automated axe results and emulated touch input do not replace physical-device or screen-reader testing.

## Final production follow-through

The separate functional reviewer subsequently executed the strengthened checks
against the final production build: 317 passes, 7 intentional skips and no
failures across all four configured profiles. Thus the nine public-route width
checks also passed at 820px and 1280px using configured physical width, and the
320px batch passed on the phone profile. See [functional evidence](REDESIGN-FUNCTIONAL.md).
This extends the earlier document-relative sweep; it does not represent a new
manual physical-device or screen-reader review.
