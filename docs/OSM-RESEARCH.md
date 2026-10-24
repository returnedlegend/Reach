# OSM mapping providers for the prototype

Research checked 2026-10-17. OSM data is open under ODbL; that does not make OSMF's public servers an unrestricted free API. Keep map, search, and routing URLs in provider configuration so they can be changed independently.

| Need | Prototype choice | Limits and production path |
|---|---|---|
| Map display | **MapLibre GL JS** with an OSM raster source for the low-traffic prototype. Use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; show `© OpenStreetMap contributors` persistently on the map and link attribution to the copyright page. Keep the raster URL configurable. | OSMF tile service is best effort with no SLA; no bulk download or prefetch, honor caching (at least 7 days if cache headers are unavailable), allow browser Referer, do not send no-cache headers. At scale move to a hosted OSM-derived tile service or self-host. **OpenFreeMap** is a key-free hosted vector alternative with an explicit free-use offer, but says it has no SLA. **Leaflet** is a smaller/simple 2D library and works naturally with raster tiles; choose it if the app only needs basic pan/zoom and overlays. MapLibre is a better fit for vector styling and future richer map rendering, and can also display raster sources. |
| Place search | **Nominatim public API, only for explicit user-submitted searches** (button/Enter), with debounce disabled, a single shared server-side rate limiter capped at 1 request/second across all users, positive/negative result caching, identifying User-Agent and contact, and an easily switched endpoint. | Do not implement autocomplete or issue a request for every keystroke; public Nominatim policy expressly forbids client-side autocomplete. Its 1 rps ceiling is aggregate per application, not per browser. Moderate direct user-triggered searches are permitted, but service is donation-funded/no SLA. Move to a commercial geocoder or self-host before traffic makes the ceiling or availability inappropriate. Avoid sending sensitive queries. |
| Walking route | **Configurable Valhalla-compatible endpoint** as provider interface. During development, use a community endpoint only when opted in and at low rate; otherwise keep routing disabled or use a developer's own endpoint. For a shared prototype/demo, prefer **openrouteservice (ORS)** with a project-owned API key stored server-side; call its foot-walking profile. | Public routing demos (including OSRM's demo router and community Valhalla instances) are demonstrations, not dependable production APIs and do not provide an SLA. ORS requires a key and applies account/endpoint quotas; check current plan limits and terms. For sustained production traffic, use a paid contracted service or operate Valhalla/OSRM/GraphHopper yourself. |

## Suggested configuration

Use independent, replaceable settings (names are illustrative):

```text
MAP_PROVIDER=maplibre
MAP_RASTER_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
MAP_ATTRIBUTION=© OpenStreetMap contributors
GEOCODER_PROVIDER=nominatim
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_MIN_INTERVAL_MS=1000
ROUTER_PROVIDER=valhalla
ROUTER_BASE_URL=<explicitly configured endpoint>
ROUTER_PROFILE=pedestrian
ORS_API_KEY=<server-side secret; only when ORS is selected>
```

For an ORS shared prototype, use an explicit provider switch and keep the key out of browser code. Add a shared limiter/cache around Nominatim rather than allowing independent client tabs to each send one request per second. Never prefetch map tiles or geocode a dataset against the public Nominatim service. Include visible attribution and a link to `https://www.openstreetmap.org/copyright`.

## Provider notes

- **MapLibre vs Leaflet:** MapLibre GL JS is a WebGL renderer with style/spec support and accepts raster and vector sources. Leaflet is a focused 2D map library with a simple raster `TileLayer` and built-in attribution control. The data/service policy is determined by the tile provider, not the renderer.
- **OSM raster vs OSM vector:** OSMF publishes both raster tiles at `tile.openstreetmap.org` and Shortbread vector tiles at `vector.openstreetmap.org`. Both are donation-backed, best-effort, lack SLA, require visible attribution and app identification, prohibit bulk downloading, and require caching. OSMF advises making the service switchable. A hosted OSM-derived provider removes pressure from OSMF infrastructure but has its own terms and availability limits.
- **Routing choices:** OSRM, Valhalla, and GraphHopper are routing engines that can be self-hosted; the engine's license/API does not grant unrestricted use of any public demo server. ORS is a hosted API, requires an API key, and publishes endpoint restrictions. Keep a provider adapter so the application does not depend on a demo host's quirks.

## Official references

- OSMF Tile Usage Policy: https://operations.osmfoundation.org/policies/tiles/
- OSMF Vector Tile Usage Policy: https://operations.osmfoundation.org/policies/vector/
- OSM copyright and attribution: https://www.openstreetmap.org/copyright
- OSMF Nominatim Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
- MapLibre GL JS documentation: https://maplibre.org/maplibre-gl-js/docs/
- Leaflet reference: https://leafletjs.com/reference.html
- OpenFreeMap service and terms entry point: https://openfreemap.org/ (follow its Terms of Service link for current terms)
- Valhalla HTTP API: https://valhalla.github.io/valhalla/api/
- Example working Valhalla community route endpoint used to verify pedestrian profile support: https://valhalla1.openstreetmap.de/route (community service; do not treat as a production commitment)
- OSRM API / demo: https://project-osrm.org/docs/v5.24.0/api/ and https://router.project-osrm.org/ (demo endpoint; no production SLA)
- GraphHopper Directions API terms: https://www.graphhopper.com/terms/
- openrouteservice API restrictions: https://openrouteservice.org/restrictions/
- openrouteservice terms: https://openrouteservice.org/terms-of-service/
