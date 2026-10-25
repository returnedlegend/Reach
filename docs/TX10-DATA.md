# Current expansion — October 25, 2026

The production directory now has **29 sites**, adding Elgin Community Cupboard, Smithville Food Pantry, Bellville Christian Food Pantry, Columbus Food Pantry and Flatonia Area Food Pantry. See [official sources and coordinate evidence](TX10-EXPANSION-2026-10-25.md). WARM remains a research lead with no verified map point. This is reviewed coverage, not a claim that every TX-10 pantry is listed.

The following section documents the earlier 24-site baseline.

# TX-10 food pantry data

The production pantry directory now contains 24 food sites: the original eight Brazos County listings plus 16 additions whose pickup points fall inside the official 119th Congress TX-10 boundary. The new sites have public schedule and service evidence in the primary provider or food-bank source listed in each record. Their entrances, pedestrian paths, same-day inventory, and holiday exceptions have not been reviewed.

New production sites:

- Anderson Food Pantry
- Bedias Food Pantry
- Christian Community Services (Navasota)
- Elizabeth Lutheran Church Pantry
- In God's Hands Ministry
- Grimes Mobile Pantry
- Madison Mobile Pantry
- Prairie Hill Food Pantry
- Faith Mission
- Caldwell Christians Care
- Lee Chapel United Methodist Church
- New Zion Food Pantry
- Bastrop County Emergency Food Pantry
- Giddings Food Pantry (Giddings Area C.A.R.E. Center)
- AMEN La Grange Food Pantry
- Schulenburg Area Food Pantry

The BVFB food-bank directory supplies the first nine sites' actual distribution hours, service area, pickup format and limits, and its county listings supply the Caldwell, Bryan, Grimes and Washington-area records. The 2026 Madison flyer conflicts with the stated fourth-Thursday recurrence: October 22 is a fourth Thursday, but November 19 and December 17 are third Thursdays. The record retains the published text, models no recurrence window, and tells visitors to confirm the flyer. Bedias' directory address is 3202 Main Street while its linked Maps destination says 3203 Main Street, so its pin and details remain flagged for confirmation. Grimes and Madison use the named fairgrounds destination points and retain an event-gate caveat.

Bastrop County Emergency Food Pantry is supported by the nonprofit's official Food Assistance, Community Market, Fresh Foods for Families, and contact pages. Its food-assistance windows are appointment-only; its community market permits walk-ins; its monthly fresh-food distribution is listed separately. Giddings Food Pantry is supported by its official homepage, calendar and contact pages. Its calendar publishes event-specific dates rather than a stable recurrence, so the production schedule window list is empty and the calendar link remains part of its provenance. AMEN La Grange's official homepage states its Fayette County mission, and its contact page gives Monday and 1st/3rd Thursday food-pickup hours and the Reynolds Street location. Schulenburg Area Food Pantry's official homepage states its weekly Thursday distribution hours and location; its Contact and About pages confirm the address, modified client-choice process and monthly visit limit. Neither provider's reviewed pages state an appointment policy, so the machine-readable windows leave `appointmentRequired` unset. The official Census Geocoder `Public_AR_Current` benchmark returned address-range points for these regional locations, not surveyed entrance points. These approximate coordinates are explicitly described in the records; entrance-level positioning is unverified.

TX-10 membership was checked by point-in-polygon against `data/geo/tx10-119.geojson`, using the pure `pointInCoverage` routine and a server-side test that reads the GeoJSON from disk. The 444 KB geometry is not imported into client data. Three Hearne/Franklin BVFB candidates (Progressive Missionary Baptist Church, Robertson County Cares, and Call for Help) were excluded because their mapped points lie outside the district. Washington Mobile Pantry is not admitted because its BVFB-linked Maps URL provides only a camera center, not a destination point. Its coordinates remain null in research. No city/county assumption was used to determine coverage.

All additions preserve source URLs and checked dates. Food-bank candidates use BVFB's global statement that ID and proof of income/address may be requested but can never be required; no additional eligibility rules are inferred. The four regional providers have their own program-specific intake/application information. Unknown eligibility and accessibility details remain identified as unknown. Service areas are populated only when the listing explicitly states a geographic area; they are not parsed from other eligibility prose. General office hours are not treated as pickup times. Structured `windows` include only schedules that map cleanly to recurring calendar rules; Giddings and Madison have empty lists because their available dates do not support a reliable generic recurrence. BVFB schedule windows leave `appointmentRequired` unset and `policyKnown` false because the directory does not state an appointment policy. Bastrop records use true/false only for programs whose official pages explicitly require appointments or welcome walk-ins. None of the windows invents a registration cutoff.
