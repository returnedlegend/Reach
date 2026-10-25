# Household food sharing in search

Approved household food offers now appear in the main pantry/food search and can be ranked by AI alongside maintained pantries and community hotspots. Both household offers and hotspots still require moderator approval; submission creates a pending record, never a public result.

## Privacy and availability

- Public search includes only valid, approved, unexpired offers with a use-by date covering the pickup window. Accepted reservations and pending/open/assigned volunteer pickups remove an offer from search.
- Household offers have **no public pickup coordinates**. Their city is an approximate area, not a destination. The main action is **Request food**, opening the community offer view; generic saved-card and sharing actions also avoid Google routing to a city center or private address.
- Private pickup instructions, sharing-consent fields and owner account identifiers are never copied into search resources or AI candidate facts. Public title/description/allergen fields remain public; authors must not put private details in those fields and moderators should check them.
- Signed-in page results and native AI search honor blocks in both directions. Public listings remain visible to signed-out visitors, as with existing Community discovery. Cookies are used only to resolve the session and filter records; they are not sent to the model.
- Food safety and available stock are not verified. The existing manufacturer-sealed, shelf-stable, non-homemade food rules remain; this change does not enable cooked household leftovers.

## Clearer interface

Cards show a concise title, food category/quantity, reported pickup window and primary action. Household cards carry this brief disclaimer: “Community-shared food. Safety and availability aren’t verified. Check allergens and packaging; arrange pickup before traveling.” Allergens, storage, use-by information, requirements and sources remain under **Pickup times & what to bring**. Repeated AI explanation and hotspot verification paragraphs were shortened. No safety confirmations, report/block actions or moderator controls were removed.

AI's six-candidate comparison reserves up to two community slots, including one hotspot and one household offer when both match. Returned IDs must belong to the server-owned candidate set. Household timing is donor-reported, hotspot timing is organizer-reported, and neither establishes food stock or a feasible trip. Advanced verified transit and round-trip planning still need supported pantry/route data.

## Review evidence

A Luna implementation agent added the public offer adapter and bounded tests; another handled the Community entry flow/disclaimer. Independent Luna review caught missing signed-in block filtering and incorrect “organizer” wording for household timing; both were fixed and independently rechecked. No production offers were seeded and no real food or external AI availability was verified by fixture tests.

Final validation: 684 unit tests across 79 files passed, along with TypeScript, maintained-data validation and the production build. Twelve distinct targeted Chromium cases passed across mobile and desktop (household search/privacy/request/block flow, hotspot selection, pantry AI ordering and loading/accessibility). The household browser case also blocks an owner through Community, returns to Explore and confirms the offer is absent. Community mutations refresh server-owned search resources without resetting the active view. Inference was mocked in browser/model-fixture checks; these results do not claim live model performance or real food availability.
