# Map, search, and route provider setup

Reach's map uses MapLibre GL JS. By default, it loads the hosted OpenFreeMap `liberty` style, which is based on OpenStreetMap data. The default requires no Google API key, map ID, or other key. The vector map displays OpenMapTiles credit and `© OpenStreetMap contributors` with a link to the OSM copyright page. OpenFreeMap describes its service as having no SLA; review its current terms and availability before relying on it for a public deployment.

## Configure the map display

The defaults in `src/lib/map-config.ts` can be overridden at build time:

- `NEXT_PUBLIC_MAP_STYLE_URL` selects a MapLibre style URL. The default is `https://tiles.openfreemap.org/styles/liberty`.
- `NEXT_PUBLIC_MAP_RASTER_TILE_URL` selects a raster template such as `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. When set, the app adds OSM attribution and any value in `NEXT_PUBLIC_MAP_RASTER_ATTRIBUTION`.

For OSM Foundation raster tiles, show attribution persistently, retain a working browser Referer, honor cache headers (at least seven days if none are provided), and do not bulk-download, prefetch, or send no-cache requests. This public tile service is best effort with no SLA. At sustained traffic, use a hosted provider whose terms and capacity fit your deployment or operate suitable infrastructure. A custom raster or style provider may require its own attribution; review and display it as well. Public `NEXT_PUBLIC_` map settings are included in the browser build, so rebuild after changing them.

## Optional address search

Address search is disabled by default. The location picker sends a request only when the user submits the address form; typing does not trigger requests or autocomplete. The entered address goes from the browser to Reach's server, then to the configured geocoder. Candidates are shown for an explicit user selection. Avoid entering sensitive addresses when using a public geocoder.

For the public Nominatim service, configure all of the following deliberately:

```dotenv
OSM_GEOCODER_URL=https://nominatim.openstreetmap.org
OSM_NOMINATIM_SINGLE_INSTANCE=true
OSM_USER_AGENT=Reach (https://example.org; contact: maps@example.org)
```

Replace the example URL and contact with deployment details. The opt-in is an operator assertion that this service runs as one instance on one host; do not set it on a serverless or multi-instance deployment. The code also recognizes several common serverless platforms and fails closed for public Nominatim there. Its filesystem lock coordinates processes on one host only, not separate hosts.

The public-host gate enforces at most one request every 1.1 seconds across processes sharing that host, with bounded pending work. Identical concurrent submissions are coalesced. Successful results are kept in a bounded in-memory cache for five minutes and no-match results for 30 seconds; cache state is per process and disappears on restart. The gate fails closed when its lock state is malformed or unavailable. These controls do not turn Nominatim into a production geocoding service or guarantee availability. Follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and move to a contracted or self-hosted service if your traffic or reliability needs exceed it.

If a different Nominatim-compatible service is selected, set `OSM_GEOCODER_URL` to its HTTPS origin. The service must return Nominatim-compatible JSON. The code does not apply the public Nominatim single-host throttle to a custom host; check and implement that provider's own rate limits and contact requirements before enabling it.

## Optional walking and driving routes

Route calculation is disabled by default. Transit requests do not use this routing adapter; Reach uses its separately sourced BTD timetable and does not claim live arrivals.

For a Valhalla-compatible service that you operate or have permission to use, configure:

```dotenv
OSM_ROUTER_MODE=valhalla
OSM_ROUTER_URL=https://your-valhalla-service.example
```

Only use an HTTPS origin without credentials, path, query, or fragment. The adapter sends walking requests with Valhalla's pedestrian costing and driving requests with auto costing. It validates the returned route and labels it a Valhalla estimate. Keep any provider-specific credentials in server-side configuration; this adapter currently does not add an API-key header.

For limited development evaluation only, an operator may explicitly select the community demo:

```dotenv
OSM_ROUTER_MODE=valhalla-demo
```

This uses `https://valhalla1.openstreetmap.de`. FOSSGIS's [published service terms](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/) explicitly cover this host and permit creative third-party use subject to their conditions. They require OSM attribution and a link to report map errors, an app-identifying User-Agent, a valid Referrer where technically possible, and no more than one request per second. High-traffic websites and mass downloads are prohibited. The terms publish no per-IP or daily request allowance and no student-specific exception. Reach's shared-host gate waits 1.1 seconds between requests and its demo guard limits trips to 100 miles; the 100-mile cap is Reach's safeguard, not a provider quota. The demo mode also refuses multi-instance hosting.

For a local, low-volume, single-instance prototype, copy the commented `OSM_ROUTER_MODE=valhalla-demo` setting from `.env.example` into `.env.local`. Supply an honest identifying `OSM_USER_AGENT` with your project's public contact details and a Referrer when technically possible. Keep the required attribution and fix-the-map link visible in the route UI. Do not deploy this configuration as a production dependency: FOSSGIS runs the service on a single server, gives no availability guarantee, can change the terms without notice, and can revoke access. The community service is not a production SLA or guaranteed capacity. A successful route is only an estimate, not verification of a safe, accessible, open, or current path. For production reliability, use an explicitly provisioned routing provider or host Valhalla yourself.

`OSM_ROUTER_MODE` defaults to `disabled`. An unconfigured or unavailable route returns an explicit unavailable state; the app does not substitute straight-line distances. No Google credentials are involved in the default map or in these optional OSM-compatible services.

## References

- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OpenFreeMap service and terms](https://openfreemap.org/)
- [Valhalla HTTP API](https://valhalla.github.io/valhalla/api/)
- [FOSSGIS OSM server terms](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/)
- [FOSSGIS routing server information](https://routing.openstreetmap.de/about.html)
- [OpenRouteService API documentation](https://openrouteservice.org/dev/#/api-docs)
- [OSM provider research and alternatives](OSM-RESEARCH.md)

## Operational notes

The current Nominatim policy specifically requires an informed developer decision for LLM-generated integrations. The public service remains disabled until the operator deliberately opts in after reading its policy. Do not enable it automatically or use it for autocomplete.

Public service gates store timestamps and atomic locks under `/tmp/reach-osm-<uid>-nominatim` and `/tmp/reach-osm-<uid>-valhalla-demo`, without addresses or coordinates. A crash can leave the gate closed. Stop all Reach processes on that host before inspecting/removing a stale lock or resetting a corrupted gate directory; never reset a running limiter to bypass its rate limit.

Some cloud environments require Node24's `NODE_USE_ENV_PROXY=1` to use their supplied network proxy. Enable it only when applicable; keep TLS certificate verification enabled. Browser trust and Node proxy configuration are separate. See the verification report for actual environment-specific external checks.

The source-backed bus overlay comes from the official GTFS shape geometry, reproduced with `python3 scripts/import-btd-shapes.py`. It represents published paths, not vehicle locations. Missing pedestrian access links are not filled with straight lines. This does not resolve conflicting timetables or verify accessible entrances.
