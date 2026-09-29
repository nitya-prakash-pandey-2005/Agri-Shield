"""
Agri-SHIELD — tropical-cyclone track builder (IBTrACS, last 3 years)
===================================================================
Author: Nitya Prakash Pandey

Writes ``apps/web/server/data/real/cyclone-tracks.json`` — compact best tracks of
every tropical cyclone of the last three seasons in the Asia-Pacific window the
platform monitors (North Indian Ocean + West Pacific + the eastern South Indian /
South Pacific rim), used by the Earth Twin globe (animated track arcs) and its
time machine.

Source
------
NOAA NCEI **IBTrACS v04r01** (International Best Track Archive for Climate
Stewardship), ``ibtracs.last3years.list.v04r01.csv`` — Knapp et al. 2010,
*BAMS* 91, 363-376; doi:10.25921/82ty-9e16. Public domain (US Government work).
Downloaded once into ``scripts/data/.cache/`` (~10 MB).

Transformation
--------------
* Keep storms whose track has at least one fix inside lon 60°E-160°E,
  lat 20°S-45°N and whose lifetime-max wind reaches tropical-storm strength
  (>= 34 kt). Recent storms are only available as ``PROVISIONAL`` /
  ``US-PROVISIONAL`` tracks (not yet reanalysed); they are kept and flagged
  ``provisional: true``.
* Wind: ``USA_WIND`` (JTWC 1-min sustained, kt) when present, else ``WMO_WIND``
  (agency 10-min wind, kt). Pressure: ``USA_PRES`` else ``WMO_PRES`` (hPa).
* Category (Saffir-Simpson on the 1-min wind): -1 TD (< 34 kt), 0 TS (34-63),
  1 (64-82), 2 (83-95), 3 (96-112), 4 (113-136), 5 (>= 137).
* Fixes thinned to 6-hourly synoptic times (00/06/12/18 UTC) plus the lifetime
  peak; lat/lon rounded to 0.1°.

Output schema
-------------
``{ generated, source, licence, fields, tracks: [ { id, name, season, basin,
start, maxWindKt, minPresHpa, maxCategory, provisional, points: [[hoursSinceStart, lat, lon,
windKt|null, presHpa|null, category], ...] } ] }``

Usage (from repo root):  python scripts/data/build_cyclone_tracks.py
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone

from common import CACHE, get_bytes, log, today, write_json

URL = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv"
BBOX = (60.0, 160.0, -20.0, 45.0)  # lon0, lon1, lat0, lat1


def num(v: str) -> float | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def category(wind: float | None) -> int:
    if wind is None or wind < 34:
        return -1
    if wind < 64:
        return 0
    if wind < 83:
        return 1
    if wind < 96:
        return 2
    if wind < 113:
        return 3
    if wind < 137:
        return 4
    return 5


def main() -> None:
    path = get_bytes(URL, "ibtracs.last3years.csv")
    storms: dict[str, dict] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        rd = csv.DictReader(fh)
        for row in rd:
            sid = row["SID"].strip()
            if not sid or row["SEASON"].strip() == "Year":  # units row
                continue
            track_type = row.get("TRACK_TYPE", "main").strip() or "main"
            lat, lon = num(row["LAT"]), num(row["LON"])
            if lat is None or lon is None:
                continue
            t = datetime.strptime(row["ISO_TIME"].strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            wind = num(row["USA_WIND"]) if num(row["USA_WIND"]) is not None else num(row["WMO_WIND"])
            pres = num(row["USA_PRES"]) if num(row["USA_PRES"]) is not None else num(row["WMO_PRES"])
            s = storms.setdefault(sid, {
                "id": sid,
                "name": row["NAME"].strip().title() if row["NAME"].strip() not in ("", "NOT_NAMED") else "Unnamed",
                "season": int(row["SEASON"]),
                "basin": row["BASIN"].strip() or "NA",
                "provisional": track_type != "main",
                "fixes": [],
            })
            s["fixes"].append((t, lat, lon, wind, pres))

    lon0, lon1, lat0, lat1 = BBOX
    out = []
    for s in storms.values():
        fixes = sorted(s["fixes"], key=lambda f: f[0])
        if not any(lon0 <= f[2] <= lon1 and lat0 <= f[1] <= lat1 for f in fixes):
            continue
        winds = [f[3] for f in fixes if f[3] is not None]
        max_wind = max(winds) if winds else None
        if max_wind is None or max_wind < 34:
            continue
        peak_i = max(range(len(fixes)), key=lambda i: fixes[i][3] if fixes[i][3] is not None else -1)
        start = fixes[0][0]
        pts = []
        for i, (t, lat, lon, wind, pres) in enumerate(fixes):
            if t.minute != 0 or (t.hour % 6 != 0 and i != peak_i):
                continue
            h = round((t - start).total_seconds() / 3600)
            pts.append([h, round(lat, 1), round(lon, 1), None if wind is None else int(round(wind)), None if pres is None else int(round(pres)), category(wind)])
        if len(pts) < 2:
            continue
        pres_all = [f[4] for f in fixes if f[4] is not None]
        out.append({
            "id": s["id"],
            "name": s["name"],
            "season": s["season"],
            "basin": s["basin"],
            "start": start.strftime("%Y-%m-%dT%H:%MZ"),
            "maxWindKt": int(round(max_wind)),
            "minPresHpa": int(round(min(pres_all))) if pres_all else None,
            "maxCategory": category(max_wind),
            "provisional": s["provisional"],
            "points": pts,
        })
    out.sort(key=lambda s: s["start"])
    log(f"{len(out)} Asia-Pacific tracks, {sum(len(s['points']) for s in out)} fixes (from {len(storms)} storms)")
    write_json("cyclone-tracks.json", {
        "generated": today(),
        "source": "NOAA NCEI IBTrACS v04r01 (last 3 years), " + URL,
        "licence": "Public domain (US Government work); cite Knapp et al. 2010, BAMS 91:363-376, doi:10.25921/82ty-9e16",
        "bbox": {"lon": [lon0, lon1], "lat": [lat0, lat1]},
        "fields": ["hoursSinceStart", "lat", "lon", "windKt", "presHpa", "category"],
        "tracks": out,
    })


if __name__ == "__main__":
    _ = CACHE
    main()
