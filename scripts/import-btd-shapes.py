"""Project published Orange geometry from the reviewed GTFS snapshot; no network."""
import csv, hashlib, io, json, math, zipfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = root / 'data/transit/btd-2026-10-15.zip'
provenance = json.loads((root / 'data/transit/provenance.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == provenance['snapshotSha256']
timetable = json.loads((root / 'src/data/btd-timetable.json').read_text())
ids = {t['id'] for t in timetable['trips']}
with zipfile.ZipFile(source) as z:
    def rows(name):
        return list(csv.DictReader(io.TextIOWrapper(z.open(name))))
    trips = {t['trip_id']: {'shapeId':t['shape_id'], 'stops':{}} for t in rows('trips.txt') if t['trip_id'] in ids}
    shapes = {t['shapeId']:[] for t in trips.values()}
    for s in rows('shapes.txt'):
        if s['shape_id'] not in shapes: continue
        lon, lat, distance = float(s['shape_pt_lon']), float(s['shape_pt_lat']), float(s['shape_dist_traveled'])
        assert all(math.isfinite(x) for x in [lon,lat,distance]) and -180<=lon<=180 and -90<=lat<=90
        shapes[s['shape_id']].append((int(s['shape_pt_sequence']), [lon,lat,distance]))
    for s in rows('stop_times.txt'):
        if s['trip_id'] in trips and s['stop_id'] in {p['id'] for p in timetable['stops']}:
            distance=float(s['shape_dist_traveled'])
            assert math.isfinite(distance)
            trips[s['trip_id']]['stops'][s['stop_id']] = distance
    shapes = {k:[p for _,p in sorted(v)] for k,v in shapes.items()}
    for points in shapes.values():
        assert len(points)>1 and all(a[2]<=b[2] for a,b in zip(points,points[1:]))
    assert len(trips)==len(ids)
output={'source':{'url':provenance['sourceUrl'],'checkedOn':provenance['checkedOn'],'sha256':provenance['snapshotSha256']}, 'shapes':shapes,'trips':trips}
(root/'src/data/btd-shapes.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'Projected {len(shapes)} published shapes for {len(trips)} trips; no inferred street routes.')
