# Archived Google adapter

Reach migrated its normal map, geocoding and routing endpoints to OpenStreetMap-compatible providers on October 17, 2026. See [current provider setup](OPENSTREETMAP.md).

No Google API key or map ID is needed. Setting the former Google environment variables does not enable a Google browser map or switch the production API handlers. The unused server adapter in `src/lib/google-services.ts` and its mocked unit tests remain for reference; live Google integration was never verified. Reconnecting it would require an explicit implementation and review of current Google display, attribution, billing and storage policies.

The **Open in Google Maps** links remain available. These external, keyless links pass the selected origin and destination to Google Maps to calculate directions there. They do not prove that Reach retrieved a route. See [Maps URLs documentation](https://developers.google.com/maps/documentation/urls/guide).

Obsolete Google credential requirements may remain in previously published cloud-environment settings. Remove them through the environment review UI; the draft tool cannot remove saved secret bindings. Never paste credentials into chat or commit them.
