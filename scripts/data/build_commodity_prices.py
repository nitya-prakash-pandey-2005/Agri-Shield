"""
Agri-SHIELD — real commodity price builder
==========================================
Author: Nitya Prakash Pandey

Writes ``apps/web/server/data/real/commodity-prices.json``: monthly USD prices
for the last ~5 years, used by the demo seed for ``commodities[].priceHistory``
and ``basePriceUsd`` (and available to finance/insurance modules).

Sources
  * World Bank Commodity Price Data ("Pink Sheet"), monthly, nominal USD —
    CC BY 4.0. The current workbook URL is discovered from
    https://www.worldbank.org/en/research/commodity-markets (link text
    "Monthly prices"); falls back to the last known URL.
      rice Thai 5%, rice Viet Namese 5%, wheat US HRW, maize, sugar (world),
      coconut oil, palm oil, urea, DAP.
  * WFP Global Market Monitor food prices for India via HDX (CC BY-IGO) —
    national mean of retail onion / tomato / potato prices in USD (WFP's own
    `usdprice` column), converted to a farm-gate proxy with the farmer's share
    of the consumer rupee (RBI Working Paper 2024 "Farmers' share in consumer
    rupee": onion ≈ 36 %, tomato ≈ 33 %, potato ≈ 37 %).
  * Jute: not in the Pink Sheet. Honest proxy = Government of India Minimum
    Support Price for raw jute (CACP, Kharif MSP notifications; INR/quintal,
    July–June marketing season) converted with the World Bank annual official
    exchange rate (indicator PA.NUS.FCRF).

Derived (documented) app commodities:
  rice       = Thai 5% broken, FOB Bangkok
  wheat      = US HRW, FOB Gulf
  maize      = US No.2 yellow, FOB Gulf
  sugarcane  = world raw sugar × 0.105   (≈ recoverable sucrose per tonne of cane)
  coconut    = coconut oil × 0.63        (copra-equivalent; ~63 % oil extraction)
  jute       = India raw-jute MSP (INR/q × 10 / INR per USD)
  onion      = WFP India retail onion × 0.36 (farm-gate share)
  vegetables = WFP India retail mean(tomato, potato) × 0.35 (farm-gate share)

Usage (from repo root):  python scripts/data/build_commodity_prices.py
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from common import UA, get_bytes, get_json, log, write_json
from xlsx_min import read_sheet

START = "2021-01"
FALLBACK_URL = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx"
PINK = {
    # key: (column header prefix in "Monthly Prices", unit multiplier to USD/t, label)
    "rice_thai5": ("Rice, Thai 5%", 1.0, "Rice, Thai 5% broken, FOB Bangkok"),
    "rice_viet5": ("Rice, Viet Namese 5%", 1.0, "Rice, Viet Namese 5% broken, FOB Ho Chi Minh City"),
    "wheat_hrw": ("Wheat, US HRW", 1.0, "Wheat, US No.1 hard red winter, FOB Gulf"),
    "maize": ("Maize", 1.0, "Maize, US No.2 yellow, FOB Gulf"),
    "sugar_world": ("Sugar, world", 1000.0, "Sugar, world raw (ISA daily price)"),
    "coconut_oil": ("Coconut oil", 1.0, "Coconut oil, crude, CIF Rotterdam"),
    "palm_oil": ("Palm oil", 1.0, "Palm oil, crude, CIF Rotterdam"),
    "urea": ("Urea", 1.0, "Urea, granular, FOB Middle East"),
    "dap": ("DAP", 1.0, "Diammonium phosphate, FOB US Gulf"),
}
# India raw-jute MSP, INR per quintal, by marketing season starting July of the given year (CACP / PIB releases)
JUTE_MSP_INR_Q = {2020: 4225, 2021: 4500, 2022: 4750, 2023: 5050, 2024: 5335, 2025: 5650}
FARMER_SHARE = {"onion": 0.36, "vegetables": 0.35}


def pink_sheet_url() -> str:
    try:
        html = requests.get("https://www.worldbank.org/en/research/commodity-markets", headers={**UA, "User-Agent": "Mozilla/5.0"}, timeout=60).text
        m = re.findall(r"https?://[^\"']*CMO-Historical-Data-Monthly\.xlsx", html)
        if m:
            return m[0]
    except Exception as e:  # noqa: BLE001
        log(f"page scrape failed ({e}); using fallback URL")
    return FALLBACK_URL


def load_pink(url: str) -> tuple[dict[str, pd.Series], str]:
    path = get_bytes(url, "CMO-Historical-Data-Monthly.xlsx", refresh=True)
    rows = read_sheet(str(path), "Monthly Prices")
    updated = next((str(r[0]) for r in rows[:6] if r and isinstance(r[0], str) and r[0].startswith("Updated")), "")
    hdr_i = next(i for i, r in enumerate(rows) if r and len(r) > 5 and any(isinstance(c, str) and c.startswith("Crude oil") for c in r))
    hdr = [str(c or "").strip() for c in rows[hdr_i]]
    data = [r for r in rows[hdr_i + 2:] if r and isinstance(r[0], str) and re.match(r"^\d{4}M\d{2}$", r[0])]
    idx = pd.PeriodIndex([f"{r[0][:4]}-{r[0][5:]}" for r in data], freq="M")
    out = {}
    for key, (prefix, mult, _) in PINK.items():
        col = next(i for i, h in enumerate(hdr) if h.startswith(prefix))
        vals = [(r[col] * mult if isinstance(r[col], (int, float)) else np.nan) if col < len(r) else np.nan for r in data]
        out[key] = pd.Series(vals, index=idx, dtype=float)
    return out, updated


def wfp_india() -> dict[str, pd.Series]:
    meta = get_json("https://data.humdata.org/api/3/action/package_show", {"id": "wfp-food-prices-for-india"})
    url = next(r["url"] for r in meta["result"]["resources"] if r["url"].endswith(".csv") and "markets" not in r["url"])
    path = get_bytes(url, "wfp_food_prices_ind.csv", refresh=True)
    df = pd.read_csv(path, skiprows=[1], low_memory=False)
    df["date"] = pd.to_datetime(df["date"])
    df = df[(df.pricetype == "Retail") & (df.unit == "KG") & (df.date >= "2020-06-01")]
    per = lambda c: df[df.commodity == c].groupby(df.date.dt.to_period("M")).usdprice.mean()  # noqa: E731
    onion = per("Onions")
    veg = pd.concat([per("Tomatoes"), per("Potatoes")], axis=1).mean(axis=1)
    return {"onion_retail_in": onion * 1000, "vegetables_retail_in": veg * 1000}


def inr_per_usd() -> dict[int, float]:
    data = get_json("https://api.worldbank.org/v2/country/IND/indicator/PA.NUS.FCRF", {"format": "json", "per_page": 60, "date": "2018:2026"})
    rates = {int(r["date"]): float(r["value"]) for r in data[1] if r.get("value")}
    last = max(rates)
    er = get_json("https://open.er-api.com/v6/latest/USD", cache=False)
    for y in range(last + 1, datetime.now(timezone.utc).year + 1):
        rates[y] = float(er["rates"]["INR"])  # current spot for years the WB has not published yet
    return rates


def monthly(s: pd.Series, end: pd.Period) -> list[float | None]:
    idx = pd.period_range(START, end, freq="M")
    s = s.reindex(idx)
    return [None if pd.isna(v) else round(float(v), 1) for v in s.to_numpy()]


def main() -> None:
    url = pink_sheet_url()
    log(f"Pink Sheet: {url}")
    pink, updated = load_pink(url)
    end = max(s.dropna().index.max() for s in pink.values())
    wfp = wfp_india()
    fx = inr_per_usd()

    months = pd.period_range("2020-07", end, freq="M")
    jute = pd.Series([JUTE_MSP_INR_Q[max(k for k in JUTE_MSP_INR_Q if k <= (p.year if p.month >= 7 else p.year - 1))] * 10 / fx.get(p.year, fx[max(fx)]) for p in months], index=months)

    def hold(s: pd.Series) -> pd.Series:
        return s.reindex(pd.period_range(START, end, freq="M")).ffill()

    series = {k: {"label": PINK[k][2], "unit": "USD/t", "source": "World Bank Pink Sheet", "values": monthly(v, end)} for k, v in pink.items()}
    series["jute_msp_in"] = {"label": "Raw jute, India MSP (TD-3), converted at WB annual official FX", "unit": "USD/t", "source": "CACP MSP + World Bank PA.NUS.FCRF", "values": monthly(jute, end)}
    for k, s in wfp.items():
        series[k] = {"label": f"{'Onion' if 'onion' in k else 'Tomato+potato'} retail, India national mean (WFP)", "unit": "USD/t", "source": "WFP via HDX", "lastObserved": str(s.dropna().index.max()), "values": monthly(s, end)}

    app = {
        "rice": ("rice_thai5", 1.0, "Pink Sheet rice, Thai 5% (FOB Bangkok)"),
        "wheat": ("wheat_hrw", 1.0, "Pink Sheet wheat, US HRW"),
        "maize": ("maize", 1.0, "Pink Sheet maize, US No.2 yellow"),
        "sugarcane": ("sugar_world", 0.105, "Pink Sheet world raw sugar × 0.105 recoverable sucrose per t cane"),
        "coconut": ("coconut_oil", 0.63, "Pink Sheet coconut oil × 0.63 (copra equivalent)"),
        "jute": ("jute_msp_in", 1.0, "India raw-jute MSP (CACP) in USD — proxy, jute is not in the Pink Sheet"),
        "onion": ("onion_retail_in", FARMER_SHARE["onion"], "WFP India retail onion × 0.36 farm-gate share (RBI 2024)"),
        "vegetables": ("vegetables_retail_in", FARMER_SHARE["vegetables"], "WFP India retail tomato+potato × 0.35 farm-gate share (RBI 2024)"),
    }
    commodities = {}
    for c, (key, factor, note) in app.items():
        raw = pink.get(key) if key in pink else (jute if key == "jute_msp_in" else wfp[key])
        s = hold(raw) * factor
        commodities[c] = {"series": key, "factor": factor, "method": note, "values": monthly(s, end)}

    write_json("commodity-prices.json", {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "start": START,
        "end": str(end),
        "pinkSheetUrl": url,
        "pinkSheetUpdated": updated,
        "licence": "World Bank Pink Sheet CC BY 4.0; WFP/HDX CC BY-IGO; CACP MSP public (Government of India)",
        "series": series,
        "commodities": commodities,
    })


if __name__ == "__main__":
    main()
