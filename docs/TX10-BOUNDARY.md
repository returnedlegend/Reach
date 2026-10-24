# Texas Congressional District 10, 119th Congress

The repository boundary in `data/geo/tx10-119.geojson` is the U.S. Census Bureau's 2024 TIGER/Line Congressional District 119 boundary for Texas district 10 (GEOID `4810`, session `119`). It represents the district serving the 2025–2027 Congress. The GeoJSON contains the single original TIGER/Line feature, reprojected from NAD83 (EPSG:4269) to WGS 84 longitude/latitude (CRS84); the geometry was not simplified or rounded.

The U.S. Census Bureau source archive is [tl_2024_48_cd119.zip](https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_48_cd119.zip). TxDOT's [Congressional district maps page](https://www.txdot.gov/data-maps/reference-maps/congressional-district-maps.html) lists the [District 10 119th Congress map](https://www.txdot.gov/content/dam/docs/division/tpp/maps/congressional/cong-district-10-119th.pdf), providing an official Texas reference for this district and Congress. The Census TIGER/Line geometry is the source used for the machine-readable boundary.

The boundary extent is longitude -98.172977 to -95.611890 and latitude 29.247804 to 31.094211. It includes the reviewed Brazos County pantry points in Bryan and College Station. A point-in-polygon check against the six BVFB pantry points documented in `PANTRY-RESEARCH-2026-10-16.md` found all six inside this district. This confirms those reviewed Bryan/College Station pantry regions intersect TX-10; it does not imply that every place in the broader Brazos Valley service area is inside the district.

Source archive and output GeoJSON SHA-256 digests, the download timestamp, district identifiers, and CRS details are recorded in `data/geo/tx10-119.metadata.json`.
