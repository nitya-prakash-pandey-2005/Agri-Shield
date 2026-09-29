"""
Agri-SHIELD — real hazard event catalogue builder
=================================================
Author: Nitya Prakash Pandey

Turns real, open hydro-meteorological records into per-district event
catalogues that the web app's deterministic demo seed uses for its historical
floods and its 200-alert archive:

  real/flood-events.json      flood episodes 2019 → last available day
  real/salinity-seasons.json  dry-season salt-intrusion severity per district-year
  real/dry-spells.json        in-season rainfall deficits (drought/dry-spell episodes)
  real/cyclones.json          tropical cyclones that hit each district (GDACS)

Sources (all free, no key):
  * apps/ml-api/data/flood_dataset.csv.gz — the ML service's committed daily panel
    (ERA5 rainfall via Open-Meteo Archive API + Copernicus GloFAS v4 river discharge
    via Open-Meteo Flood API, CC BY 4.0), 2019-01-01 … 2025-12-31.
  * The same two APIs, queried here for 2026-01-01 … (today − 6 d) so the catalogue
    reaches the present.
  * GloFAS v4 discharge at four main-stem cells as the dry-season
    salinity driver (salt-intrusion length L ∝ Q^-0.6, Savenije 2005).
    (Mekong at Kratie, Ganges at Hardinge Bridge, Mahanadi at Naraj, Pampanga at Arayat.)
  * GDACS event API (EC JRC / UN OCHA) tropical-cyclone events + wind-buffer
    geometries.

Flood event definition (identical to the ML labels in apps/ml-api/core/features.py):
  a day is a flood day when GloFAS discharge > P95 of the 2019-2022 training
  period OR the 3-day rainfall sum > its P99 (≥ 20 mm). Flood days separated by
  < 7 days are merged into one episode (the same declustering the ML stats use).
  Depth proxy (m) = 1.5·max(0,(Q/P95)^0.6 − 1) + max(0, R3 − 90)/1000·4/(1 + elev/8)
  (wide-channel Manning rating + pluvial ponding), capped at 3 m.

Usage (from repo root):   python scripts/data/build_hazard_events.py [--no-network]
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from matplotlib.path import Path as MplPath

from common import DISTRICTS, ML_DATA, get_json, log, today, write_json

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FLOOD = "https://flood-api.open-meteo.com/v1/flood"
TRAIN_END = pd.Timestamp("2023-01-01")  # same as the ML service VAL_START

MAINSTEMS = {
    # GloFAS cells chosen as the max-discharge cell in a ±0.1° search around the gauge
    "mekong": {"label": "Mekong at Kratie (GloFAS v4; upstream of tidal influence)", "lat": 12.425003, "lon": 105.975006},
    "ganges": {"label": "Ganges at Hardinge Bridge (GloFAS v4)", "lat": 24.125, "lon": 88.92502},
    "mahanadi": {"label": "Mahanadi at Naraj (GloFAS v4)", "lat": 20.475006, "lon": 85.875},
    "pampanga": {"label": "Pampanga at Arayat (GloFAS v4)", "lat": 15.075005, "lon": 120.775024},
}
SAL_DRIVER = {"VN": "mekong", "BD": "ganges", "IN": "mahanadi", "PH": "pampanga", "ID": None}
# Dry (salinity) season windows by country, months inclusive
SAL_WINDOW = {"VN": (1, 5), "BD": (1, 5), "IN": (2, 6), "PH": (1, 5), "ID": (6, 11)}
# Main cropping (wet) season months for dry-spell detection
WET_MONTHS = {"BD": range(6, 11), "IN": range(6, 11), "VN": range(5, 12), "PH": range(6, 12), "ID": [11, 12, 1, 2, 3, 4]}
GDACS_COUNTRIES = ["Bangladesh", "India", "Philippines", "Viet Nam", "Indonesia"]


def depth_proxy(q_ratio: np.ndarray, rain3: np.ndarray, elev: float) -> np.ndarray:
    riverine = 1.5 * np.clip(np.power(np.clip(q_ratio, 0, None), 0.6) - 1.0, 0, None)
    lowland = 1.0 / (1.0 + max(elev, 0.0) / 8.0)
    pluvial = np.clip(rain3 - 90.0, 0, None) / 1000.0 * 4.0 * lowland
    return np.clip(riverine + pluvial, 0.0, 3.0)


# ─── Daily panel (committed 2019-2025 + live extension) ────────────────────

def load_panel(sites: dict, network: bool) -> tuple[pd.DataFrame, str]:
    df = pd.read_csv(ML_DATA / "flood_dataset.csv.gz", parse_dates=["date"])
    df = df[["date", "site", "precip_mm", "discharge_m3s"]]
    last = df.date.max()
    end = (date.today() - timedelta(days=6)).isoformat()
    if not network or pd.Timestamp(end) <= last:
        return df, last.date().isoformat()
    start = (last + pd.Timedelta(days=1)).date().isoformat()
    ids = [d["id"] for d in DISTRICTS]
    log(f"extending panel {start} → {end} for {len(ids)} sites")
    era = get_json(ARCHIVE, {
        "latitude": ",".join(str(sites[i]["lat"]) for i in ids),
        "longitude": ",".join(str(sites[i]["lon"]) for i in ids),
        "start_date": start, "end_date": end, "daily": "precipitation_sum", "timezone": "GMT",
    })
    glo = get_json(FLOOD, {
        "latitude": ",".join(str(sites[i]["glofas_cell"]["lat"]) for i in ids),
        "longitude": ",".join(str(sites[i]["glofas_cell"]["lon"]) for i in ids),
        "start_date": start, "end_date": end, "daily": "river_discharge",
    })
    ext = []
    for sid, e, g in zip(ids, era, glo):
        t = pd.to_datetime(e["daily"]["time"])
        q = pd.Series(g["daily"]["river_discharge"], index=pd.to_datetime(g["daily"]["time"]), dtype=float)
        ext.append(pd.DataFrame({"date": t, "site": sid, "precip_mm": pd.Series(e["daily"]["precipitation_sum"], dtype=float).values, "discharge_m3s": q.reindex(t).values}))
    ext_df = pd.concat(ext)
    # ERA5 has a few days of latency: drop trailing all-NaN rain days
    ok = ext_df.groupby("date").precip_mm.apply(lambda s: s.notna().mean() > 0.8)
    ext_df = ext_df[ext_df.date.isin(ok[ok].index)]
    out = pd.concat([df, ext_df]).sort_values(["site", "date"]).reset_index(drop=True)
    return out, out.date.max().date().isoformat()


# ─── Floods ────────────────────────────────────────────────────────────────

def flood_events(panel: pd.DataFrame, sites: dict) -> dict:
    out = {}
    for d in DISTRICTS:
        sid = d["id"]
        g = panel[panel.site == sid].set_index("date").sort_index()
        tr = g[g.index < TRAIN_END]
        q = g.discharge_m3s.astype(float)
        rain = g.precip_mm.astype(float).fillna(0.0)
        rain3 = rain.rolling(3, min_periods=1).sum()
        q_p95 = float(max(tr.discharge_m3s.dropna().clip(lower=0).quantile(0.95), 1e-3))
        r3_p99 = float(max(tr.precip_mm.fillna(0).rolling(3, min_periods=1).sum().quantile(0.99), 20.0))
        elev = float(sites[sid].get("elevation_m") or 5.0)
        ev = ((q > q_p95) | (rain3 > r3_p99)).to_numpy()
        depth = depth_proxy((q / q_p95).fillna(0).to_numpy(), rain3.to_numpy(), elev)
        idx = g.index
        episodes: list[list[int]] = []
        for i in np.flatnonzero(ev):
            if episodes and (idx[i] - idx[episodes[-1][1]]).days < 7:
                episodes[-1][1] = i
            else:
                episodes.append([i, i])
        rows = []
        for a, b in episodes:
            sl = slice(a, b + 1)
            qq = q.iloc[sl]
            dd = depth[sl]
            k = int(np.nanargmax(dd)) if np.nanmax(dd) > 0 else int(np.nanargmax(np.maximum((qq / q_p95).fillna(0).to_numpy(), (rain3.iloc[sl] / r3_p99).to_numpy())))
            riv = bool((qq > q_p95).any())
            plu = bool((rain3.iloc[sl] > r3_p99).any())
            rows.append([
                idx[a].date().isoformat(),
                idx[b].date().isoformat(),
                idx[a + k].date().isoformat(),
                round(float(np.nanmax(qq)) if qq.notna().any() else 0.0, 1),
                round(float(rain3.iloc[sl].max()), 1),
                round(float(rain.iloc[max(0, a - 2): b + 1].sum()), 1),
                round(float(np.nanmax(dd)), 2),
                "both" if riv and plu else "riverine" if riv else "pluvial",
            ])
        out[sid] = {"qP95": round(q_p95, 2), "rain3P99": round(r3_p99, 1), "elevationM": elev,
                    "glofasCell": [sites[sid]["glofas_cell"]["lat"], sites[sid]["glofas_cell"]["lon"]], "events": rows}
        log(f"  {sid}: {len(rows)} flood episodes")
    return out


# ─── Dry spells ────────────────────────────────────────────────────────────

def dry_spells(panel: pd.DataFrame) -> dict:
    out = {}
    for d in DISTRICTS:
        g = panel[panel.site == d["id"]].set_index("date").sort_index()
        rain = g.precip_mm.astype(float).fillna(0.0)
        r30 = rain.rolling(30, min_periods=20).sum()
        base = r30[r30.index < pd.Timestamp("2026-01-01")]
        clim = base.groupby(base.index.dayofyear).median()
        clim = clim.reindex(range(1, 367)).interpolate(limit_direction="both").rolling(15, center=True, min_periods=1).mean()
        ratio = r30 / clim.reindex(r30.index.dayofyear).to_numpy()
        wet = np.isin(r30.index.month, list(WET_MONTHS[d["country"]]))
        # only meaningful where the season normally brings ≥ 150 mm / 30 d
        dry = (ratio < 0.45) & wet & (clim.reindex(r30.index.dayofyear).to_numpy() >= 150)
        rows = []
        run_start = None
        arr = dry.to_numpy()
        for i, v in enumerate(arr):
            if v and run_start is None:
                run_start = i
            if (not v or i == len(arr) - 1) and run_start is not None:
                end = i if v else i - 1
                if end - run_start + 1 >= 10:
                    sl = slice(run_start, end + 1)
                    rows.append([r30.index[run_start].date().isoformat(), r30.index[end].date().isoformat(),
                                 round(float(r30.iloc[sl].min()), 1), round(float(np.nanmin(ratio.iloc[sl])), 2)])
                run_start = None
        out[d["id"]] = rows
    return out


# ─── Salinity seasons ──────────────────────────────────────────────────────

def salinity_seasons(panel: pd.DataFrame, network: bool) -> dict:
    stems = {}
    if network:
        keys = list(MAINSTEMS)
        resp = get_json(FLOOD, {
            "latitude": ",".join(str(MAINSTEMS[k]["lat"]) for k in keys),
            "longitude": ",".join(str(MAINSTEMS[k]["lon"]) for k in keys),
            "daily": "river_discharge", "start_date": "2012-01-01",
            "end_date": (date.today() - timedelta(days=6)).isoformat(),
        })
        for k, r in zip(keys, resp):
            stems[k] = pd.Series(r["daily"]["river_discharge"], index=pd.to_datetime(r["daily"]["time"]), dtype=float)
    out: dict = {"drivers": {k: v["label"] for k, v in MAINSTEMS.items()}, "districts": {}}
    last_day = panel.date.max()
    for d in DISTRICTS:
        if d["sal"] < 0.3:
            continue
        c = d["country"]
        m0, m1 = SAL_WINDOW[c]
        drv = SAL_DRIVER[c]
        rows = []
        if drv and drv in stems:
            q30 = stems[drv].interpolate(limit_direction="both").rolling(30, min_periods=10).mean()
            win = q30[(q30.index.month >= m0) & (q30.index.month <= m1)]
            mins = win.groupby(win.index.year).min()
            mins = mins[mins.index >= 2019]
            ref_min = float(win.groupby(win.index.year).min().median())
            ref_med = float(win.median())
            for y, qmin in mins.items():
                wy = win[win.index.year == y]
                if len(wy) < 60:
                    continue
                below = wy[wy < ref_med]
                onset = (below.index[0] if len(below) else wy.idxmin()).date().isoformat()
                peak = wy.idxmin().date().isoformat()
                idx = float(np.clip((qmin / ref_min) ** -0.6, 0.5, 2.5))
                rows.append([int(y), onset, peak, round(idx, 2)])
        else:  # Java north coast: dry-season rainfall deficit drives intrusion into canals
            g = panel[panel.site == d["id"]].set_index("date").sort_index()
            rain = g.precip_mm.astype(float).fillna(0.0)
            r60 = rain.rolling(60, min_periods=30).sum()
            win = r60[(r60.index.month >= m0) & (r60.index.month <= m1)]
            full = win[win.index < pd.Timestamp(f"{last_day.year}-01-01")]
            ref = float(full.groupby(full.index.year).min().median()) + 5.0
            for y in sorted(set(win.index.year)):
                wy = win[win.index.year == y]
                if len(wy) < 90:
                    continue
                below = wy[wy < 60]
                onset = (below.index[0] if len(below) else wy.idxmin()).date().isoformat()
                peak = wy.idxmin().date().isoformat()
                idx = float(np.clip(((ref) / (float(wy.min()) + 5.0)) ** 0.5, 0.5, 2.5))
                rows.append([int(y), onset, peak, round(idx, 2)])
        # Root-zone ECe (dS/m): the ML dataset's calibrated dry-season P95 (0.6 + 15·s²) × min(1.45, index^0.5)
        # (the 1.45 cap mirrors the soft ceiling of the ML dataset's generator)
        for r in rows:
            r.append(round((0.6 + 15.0 * d["sal"] ** 2) * min(1.45, r[3] ** 0.5), 1))
        out["districts"][d["id"]] = {"driver": drv or "era5-rain60-deficit", "seasons": rows}
    return out


# ─── Cyclones (GDACS) ──────────────────────────────────────────────────────

def _hav(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def _polys(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [p[0] for p in geom["coordinates"]]
    return []


def cyclones(network: bool) -> list:
    if not network:
        return []
    events: dict[int, dict] = {}
    for c in GDACS_COUNTRIES:
        data = get_json("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH", {
            "eventlist": "TC", "fromDate": "2019-01-01", "toDate": today(), "alertlevel": "Green;Orange;Red", "country": c,
        }, pause=0.5)
        for f in data.get("features", []):
            p = f["properties"]
            eid = int(p["eventid"])
            if eid not in events or int(p["episodeid"]) > int(events[eid]["episodeid"]):
                events[eid] = p
    log(f"  GDACS: {len(events)} TC events touching the five countries")
    out = []
    for eid, p in sorted(events.items(), key=lambda kv: kv[1]["fromdate"]):
        try:
            geo = get_json("https://www.gdacs.org/gdacsapi/api/polygons/getgeometry", {"eventtype": "TC", "eventid": eid, "episodeid": p["episodeid"]}, pause=0.3)
        except Exception as e:  # noqa: BLE001
            log(f"  skip {p['name']}: {e}")
            continue
        feats = geo.get("features", [])
        buffers = {cls: [MplPath(np.array(r)) for f in feats if f["properties"].get("Class") == cls for r in _polys(f["geometry"])]
                   for cls in ("Poly_Red", "Poly_Orange", "Poly_Green")}
        track = []  # (lat, lon, iso datetime)
        for f in feats:
            cls = f["properties"].get("Class", "")
            if cls.startswith("Point_Polygon_Point") and f["properties"].get("polygondate"):
                ring = np.array(_polys(f["geometry"])[0])
                track.append((float(ring[:, 1].mean()), float(ring[:, 0].mean()), f["properties"]["polygondate"]))
        if not track:
            continue
        tl = np.array([t[0] for t in track])
        tn = np.array([t[1] for t in track])
        hits = []
        for d in DISTRICTS:
            dist = _hav(d["lat"], d["lon"], tl, tn)
            k = int(np.argmin(dist))
            cls = None
            for name, key in (("red", "Poly_Red"), ("orange", "Poly_Orange"), ("green", "Poly_Green")):
                if any(pp.contains_point((d["lon"], d["lat"])) for pp in buffers[key]):
                    cls = name
                    break
            if cls is None and dist[k] <= 150:
                cls = "near"
            if cls:
                hits.append([d["id"], track[k][2][:10], cls, round(float(dist[k]))])
        if hits:
            sev = p.get("severitydata") or {}
            out.append({"name": p["eventname"], "gdacsId": eid, "alert": p["alertlevel"], "from": p["fromdate"][:10], "to": p["todate"][:10],
                        "maxWindKmh": round(float(sev.get("severity") or 0)), "districts": hits})
            log(f"  {p['eventname']}: {[h[0] for h in hits]}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-network", action="store_true", help="only use the committed ML panel (2019-2025); skip live extension, main-stem discharge and GDACS")
    args = ap.parse_args()
    network = not args.no_network
    sites = json.loads((ML_DATA / "sites.json").read_text(encoding="utf-8"))["sites"]
    panel, last = load_panel(sites, network)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    meta = {"generated": generated, "period": [panel.date.min().date().isoformat(), last]}

    floods = flood_events(panel, sites)
    write_json("flood-events.json", {**meta, "fields": ["start", "end", "peakDate", "peakQ_m3s", "peakRain3d_mm", "rainTotal_mm", "depthProxy_m", "driver"],
                                     "definition": "GloFAS Q > P95(2019-2022) or ERA5 3-day rain > P99; gaps < 7 d merged", "districts": floods})
    sal = salinity_seasons(panel, network)
    write_json("salinity-seasons.json", {**meta, "fields": ["year", "onset", "peak", "intrusionIndex", "peakEce_dSm"], **sal})
    write_json("dry-spells.json", {**meta, "fields": ["start", "end", "minRain30d_mm", "minRatioToNormal"], "districts": dry_spells(panel)})
    if network:
        write_json("cyclones.json", {**meta, "source": "GDACS (EC JRC / UN OCHA) tropical-cyclone events and wind buffers", "fields": ["districtId", "closestApproach", "windBuffer", "distanceKm"], "events": cyclones(network)})


if __name__ == "__main__":
    main()
