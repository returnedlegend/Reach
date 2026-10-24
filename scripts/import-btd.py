#!/usr/bin/env python3
"""Validate a local BTD GTFS snapshot and deterministically project Route 00 Orange."""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STOPS = ('126', '127', '134', '142', '151', '154')
HOLIDAYS = ('2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-09-07', '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25')
SOURCE_URL = 'https://www.btd.org/2025btdgtfs/'
HOLIDAY_URL = 'https://www.btd.org/fixed-routes/'
CHECKED = '2026-10-15'

def require(ok, message):
    if not ok:
        raise ValueError(message)

def date(value):
    require(bool(re.fullmatch(r'\d{8}', value)), f'Invalid GTFS date: {value}')
    return dt.datetime.strptime(value, '%Y%m%d').date().isoformat()

def seconds(value):
    """GTFS hours may exceed 24; preserve service-day offsets, never modulo 24."""
    match = re.fullmatch(r'(\d{2,}):([0-5]\d):([0-5]\d)', value)
    require(match is not None, f'Invalid GTFS time: {value}')
    h, m, s = map(int, match.groups())
    return h * 3600 + m * 60 + s

def hhmm(value):
    total = seconds(value)
    require(total < 48 * 3600, f'Time exceeds the limited router service-day range: {value}')
    require(total % 60 == 0, f'Second-level time cannot be rounded silently: {value}')
    return f'{total // 3600:02}:{total // 60 % 60:02}'

def index(rows, key):
    result = {}
    for row in rows:
        require(row[key] and row[key] not in result, f'Missing or duplicate {key}: {row[key]}')
        result[row[key]] = row
    return result

def import_feed(path):
    raw = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.testzip() is None, 'ZIP integrity check failed')
        def read(name):
            with archive.open(name) as handle:
                return list(csv.DictReader(io.TextIOWrapper(handle, encoding='utf-8-sig')))
        agencies = index(read('agency.txt'), 'agency_id')
        feed_rows = read('feed_info.txt')
        require(len(feed_rows) == 1, 'Exactly one feed_info record required')
        feed = feed_rows[0]
        valid_from, valid_to = date(feed['feed_start_date']), date(feed['feed_end_date'])
        require(valid_from <= valid_to, 'Inverted feed validity')
        routes = index(read('routes.txt'), 'route_id')
        trips = index(read('trips.txt'), 'trip_id')
        stops = index(read('stops.txt'), 'stop_id')
        calendars = index(read('calendar.txt'), 'service_id')
        exceptions = read('calendar_dates.txt')
        times = read('stop_times.txt')
    require('BryOrange' in routes, 'BryOrange route missing')
    require(all(s in stops for s in STOPS), 'A projected stop is missing')
    require(all(a['agency_timezone'] == 'America/Chicago' for a in agencies.values()), 'Unexpected agency timezone')
    require(any(a['agency_name'] == 'Brazos Transit District' for a in agencies.values()), 'Unexpected agency identity')
    for route in routes.values():
        require(route['agency_id'] in agencies, 'Route references missing agency')
    for stop in stops.values():
        lat, lon = float(stop['stop_lat']), float(stop['stop_lon'])
        require(math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180, f'Invalid stop coordinates: {stop["stop_id"]}')
    for c in calendars.values():
        require(date(c['start_date']) <= date(c['end_date']), 'Inverted calendar dates')
        require(all(c[d] in ('0', '1') for d in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')), 'Invalid weekday flag')
    exception_map = {}
    for e in exceptions:
        require(e['service_id'] in calendars, 'Exception references missing calendar')
        require(e['exception_type'] in ('1', '2'), 'Invalid exception type')
        key = (e['service_id'], date(e['date']))
        require(key not in exception_map, 'Duplicate calendar exception')
        exception_map[key] = e['exception_type'] == '1'
    for trip in trips.values():
        require(trip['route_id'] in routes and trip['service_id'] in calendars, 'Trip references missing route/calendar')
    by_trip = {key: [] for key in trips}
    for row in times:
        require(row['trip_id'] in trips and row['stop_id'] in stops, 'Stop time references missing trip/stop')
        require(bool(re.fullmatch(r'\d+', row['stop_sequence'])), 'Stop sequence must be a nonnegative integer')
        seconds(row['arrival_time']); seconds(row['departure_time'])
        by_trip[row['trip_id']].append(row)
    for trip_id, rows in by_trip.items():
        require(len(rows) >= 2, f'Trip has fewer than two stops: {trip_id}')
        rows.sort(key=lambda r: int(r['stop_sequence']))
        sequence = [int(r['stop_sequence']) for r in rows]
        require(len(set(sequence)) == len(sequence), f'Duplicate stop sequence: {trip_id}')
        last = -1
        for row in rows:
            arrival, departure = seconds(row['arrival_time']), seconds(row['departure_time'])
            require(last <= arrival <= departure, f'Nonchronological times: {trip_id}')
            last = departure
    selected = []
    for trip_id, trip in sorted(trips.items()):
        if trip['route_id'] != 'BryOrange':
            continue
        rows = [row for row in by_trip[trip_id] if row['stop_id'] in STOPS]
        if len(rows) < 2:
            continue
        selected.append({'id': trip_id, 'route': 'BTD Route 00 Orange', 'serviceId': trip['service_id'], 'sourceIds': ['btd-gtfs', 'btd-holidays'], 'stops': [{'stopId': row['stop_id'], 'arrival': hhmm(row['arrival_time']), 'departure': hhmm(row['departure_time'])} for row in rows]})
    require(bool(selected), 'No usable projected trips')
    services = sorted({trip['serviceId'] for trip in selected})
    output_calendars = []
    for service in services:
        c = calendars[service]
        overlay = {day: active for (sid, day), active in exception_map.items() if sid == service}
        overlay.update({day: False for day in HOLIDAYS})
        output_calendars.append({'id': service, 'startDate': date(c['start_date']), 'endDate': date(c['end_date']), 'weekdays': [i for i, d in enumerate(('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')) if c[d] == '1'], 'exceptions': dict(sorted(overlay.items()))})
    output = {'timezone': 'America/Chicago', 'validFrom': valid_from, 'validTo': valid_to, 'minTransferMinutes': 5, 'calendars': output_calendars, 'trips': selected, 'stops': [{'id': sid, 'name': stops[sid]['stop_name'], 'lat': float(stops[sid]['stop_lat']), 'lon': float(stops[sid]['stop_lon'])} for sid in STOPS], 'sources': [{'id': 'btd-gtfs', 'title': 'BTD official GTFS — March 25, 2026 version; times conflict with PDF', 'url': SOURCE_URL, 'checkedOn': CHECKED, 'verificationMethod': 'website'}, {'id': 'btd-holidays', 'title': 'BTD official fixed-route 2026 holiday closures', 'url': HOLIDAY_URL, 'checkedOn': CHECKED, 'verificationMethod': 'website'}]}
    provenance = {'agency': 'Brazos Transit District', 'sourceUrl': SOURCE_URL, 'checkedOn': CHECKED, 'verificationMethod': 'website', 'snapshotSha256': hashlib.sha256(raw).hexdigest(), 'feedVersion': feed['feed_version'], 'feedValidity': {'from': valid_from, 'to': valid_to}, 'routeId': 'BryOrange', 'projectedStopIds': list(STOPS), 'projectedTripCount': len(selected), 'sourceTripCount': len(trips), 'originalCalendarExceptionCount': len(exceptions), 'holidayOverlay': {'sourceUrl': HOLIDAY_URL, 'checkedOn': CHECKED, 'dates': list(HOLIDAYS), 'note': 'Official website closures are an explicit overlay, not present in the GTFS calendar_dates file.'}, 'conflicts': [{'sources': [SOURCE_URL, 'https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf'], 'description': 'Official GTFS and official PDF publish differing timetable values. GTFS times are retained verbatim; no provider confirmation has resolved the discrepancy. Results must require confirmation.'}], 'license': 'No explicit redistribution license found in the downloaded GTFS snapshot. Attribute BTD; this is not a license grant.', 'projection': 'Only six selected Route 00 Orange stops are retained, preserving original stop order and exact minute times. Not the entire route or network.', 'walkingReview': 'Stop coordinates come from GTFS; they do not establish reviewed pedestrian routes.', 'minTransferMinutesNote': 'Five-minute planning margin, not a published guaranteed connection.'}
    return output, provenance

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'data/transit/btd-2026-10-15.zip', help='Local GTFS ZIP; no network requests are made')
    args = parser.parse_args()
    reviewed = ROOT / 'data/transit/btd-2026-10-15.zip'
    require(args.input.read_bytes() == reviewed.read_bytes(), 'Unreviewed replacement feed: update CHECKED, HOLIDAYS and source evidence in a reviewed code change before importing new data.')
    output, provenance = import_feed(args.input)
    for path, data in ((ROOT / 'src/data/btd-timetable.json', output), (ROOT / 'data/transit/provenance.json', provenance)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Imported {len(output["trips"])} trips, {len(output["stops"])} stops; SHA256 {provenance["snapshotSha256"]}')

if __name__ == '__main__':
    main()
