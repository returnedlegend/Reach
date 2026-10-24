# TX10 routing provider research

Research checked 2026-10-22. This is a bounded provider-policy review and two
live requests using the public Brazos-area street coordinates supplied for the
task. These are not private or person-specific coordinates.

## Recommendation

The FOSSGIS Valhalla community server is a viable **opt-in, low-volume,
single-instance prototype** backend for a student project, if the project meets
the published terms. The terms explicitly welcome creative third-party uses,
and explicitly list `valhalla1.openstreetmap.de` within their scope. They
require OpenStreetMap attribution and a fix-the-map link, a valid app-identifying
User-Agent, a valid Referrer where technically possible, at most one request per
second, and prohibit high-traffic sites and mass downloads. They impose no
published per-IP or daily request quota and no student-specific restriction.
There is no special student exemption either: student status does not waive
these conditions.

FOSSGIS says the services run on donations and volunteer effort, each service
has a single server, availability is not guaranteed, terms can change without
notice, and permission can be revoked. Therefore the community endpoint can
support a carefully capped prototype, but it is not a production service with
an SLA or durable capacity commitment. A production deployment should use an
explicitly provisioned/contracted routing service or self-hosted Valhalla. The
code's 100-mile demo trip guard is an application safeguard, not a FOSSGIS
published quota.

The current application already uses the compatible route API options:
Valhalla `pedestrian` for walking and `auto` for driving. `OSM_ROUTER_MODE` is
disabled by default; `valhalla-demo` explicitly opts into the community server.
That is a workable keyless demo configuration for a single instance. Keep
traffic bounded, preserve the interval of at least one second (the current
1.1-second limiter provides a small margin), retain attribution, and give the
request a meaningful app-identifying User-Agent and Referrer when possible.

## Official sources and policy evidence

- [FOSSGIS OSM server terms (English)](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/)
  says: “We are generally pleased when third parties use our services for
  creative and innovative applications.” The scope lists the FOSSGIS routing
  servers as `routing.openstreetmap.de` and `valhalla1.openstreetmap.de`.
  General requirements include clear OSM attribution and a link to
  `https://www.openstreetmap.org/fixthemap`; “Valid HTTP User-Agent identifying
  the application”; “A valid origin indication (HTTP Referrer) where
  technically possible”; and scripts limited to one connection. It says
  “Websites with high traffic volumes are generally not permitted” and “Mass
  downloading of data is prohibited.” Under additional routing-server
  conditions: “Maximum one request per second.” Finally: “each service is
  backed by only a single server. We do not guarantee availability.”
- [FOSSGIS routing server about page](https://routing.openstreetmap.de/about.html)
  independently summarizes its public server policy as one request per second,
  no scraping/heavy use, and valid User-Agent. It describes the OSRM instance;
  the FOSSGIS terms above are the controlling source that explicitly includes
  the Valhalla hostname.
- [Valhalla route API reference](https://valhalla.github.io/valhalla/api/route/api-reference/)
  documents the route request and `id` request parameter, which is echoed in a
  response when supplied. It documents routing costings such as `auto` and
  `pedestrian`. The live demo linked from the API reference is
  [valhalla.openstreetmap.de](https://valhalla.openstreetmap.de/); the API host
  tested here is `valhalla1.openstreetmap.de`.
- [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/) documents the
  OSRM route API, but that API's standard profile is driving/car-oriented. The
  FOSSGIS about page describes its deployed frontend as having car, bicycle,
  and foot profiles, while the OSRM HTTP service uses profile-specific
  deployments. This does not offer a general pedestrian mode for the app's
  current standard OSRM demo configuration, so do not substitute the public
  OSRM demo for walking without confirming a foot-profile endpoint.
- [openrouteservice API documentation](https://openrouteservice.org/dev/#/api-docs)
  requires an API key for its hosted API; it is not a keyless alternative.

The FOSSGIS terms do not publish an IP quota, daily quota, request-count
allowance, or a student/prototype carve-out. A low-volume single-instance
prototype is consistent with the stated creative-use allowance if it meets all
terms, but the terms do not promise that any particular prototype will be
accepted or remain available. No provider contact was made.

## Live read-only smoke test

Two POST `/route` requests were sent directly to the published Valhalla API,
without authentication, with the same origin and destination:

- Origin: `30.654246, -96.352911`
- Destination: `30.651377, -96.344633`
- Pedestrian then auto; requests were separated by 1.2 seconds. The User-Agent
  identified Reach, and no Referrer was supplied for these non-browser API
  requests.
- Both returned HTTP 200. Each response contained one leg. Decoded polyline6
  shapes had at least two points, maneuver indices in bounds, and start/end
  points within one mile of the supplied coordinates.

| Mode | Valhalla costing | Length | Time | Maneuvers | Shape check | Provider route ID |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Walking | `pedestrian` | 0.6881 mi | 786.619 s | 5 | valid; 19 points | not returned |
| Driving | `auto` | 0.8236 mi | 203.833 s | 8 | valid; 40 points | not returned |

The responses had no `trip.id` because no ID was requested. The API supports a
caller-supplied `id` and echoes it, so a follow-up implementation can generate
a non-sensitive correlation ID if the UI or logs need one. The full bounded
response bodies are in `/tmp/reach-tx10-routing-live.jsonl`; the compact
validated result is `/tmp/reach-tx10-routing-results.json`. Raw geometry is
kept out of this document.

These measurements only show that these requests worked at this time. They do
not establish route accuracy, pedestrian safety/accessibility, live road
conditions, service availability, capacity, or an SLA.
