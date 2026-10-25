# Core map and location audit

**Checked:** October 24, 2026 (UTC)

**Scope:** Read-only review of map and location behavior used by the home flow, plus focused mobile browser checks. No provider availability or route accuracy claims.

## Findings

- The home finder and map view share the selected starting location and destination state. “Directions in Reach” selects the pantry and opens the map flow; selecting a pantry pin uses the same destination-selection callback as its card. Changing the origin clears the prior route before it can be shown for the new point.
- Manual latitude and longitude entry rejects blank, nonnumeric, or out-of-range coordinates. Address search sends only after explicit submit; candidate choice requires a separate selection. Reverse geocoding updates the label while preserving the exact selected point.
- Routing responses are validated before route geometry is displayed. Transit does not invent street-route geometry. Failed recomputations clear route lines, announce an unavailable state, and keep external directions available.
- MapLibre markers are keyboard-operable buttons. The map has a named region and a text summary, provider failure offers retry while keeping directory cards usable, and attribution is shown below the map. Focused axe checks for the rendered map reported no violations.
- The UI and terms describe routed values as estimates and say that a pin does not establish a safe path or accessible entrance. Address search is explicit and the location privacy page explains provider sharing.

## Evidence

Focused mobile browser checks on `http://127.0.0.1:3101` passed 9 cases across `tests/osm-verification.spec.ts`: keyboard address submit and selection; geocoder failure with manual entry; invalid-coordinate rejection and no invented transit route; fixture MapLibre rendering and keyboard pantry selection; origin drag requiring confirmation; route outage fallback; map outage and retry; reverse-geocode coordinate preservation; and route geometry/legend clearing after failure. The test setup intercepted the map style, tiles, geocoder, and router; these results do not verify live providers. `tests/osm-services.test.ts` and `tests/journey.test.ts` passed 63 tests.

The browser helper now opens “Step-by-step trip controls” before entering the retained journey flow. This updates a stale test setup after the home screen began opening the simple finder by default.

## Provider limits

The default OpenFreeMap style and optional FOSSGIS Valhalla demo have no production availability guarantee; the router is disabled by default and transit is limited to published local timetable data. Public provider status, actual cartography, route safety, and live service quality were not checked. See [OpenStreetMap setup](OPENSTREETMAP.md) for provider configuration and operating limits.
