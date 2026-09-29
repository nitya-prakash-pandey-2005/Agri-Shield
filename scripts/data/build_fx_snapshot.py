"""
Agri-SHIELD — FX snapshot builder
=================================
Author: Nitya Prakash Pandey

Writes ``apps/web/server/data/real/fx-snapshot.json`` — units of each currency
per 1 USD from the free ExchangeRate-API open endpoint
(https://open.er-api.com/v6/latest/USD, attribution required: "Rates by
Exchange Rate API", https://www.exchangerate-api.com). The web app's
``server/live/fx.ts`` refreshes these live every 12 h and falls back to this
committed snapshot when offline.

Usage (from repo root):  python scripts/data/build_fx_snapshot.py
"""
from __future__ import annotations

from common import get_json, write_json


def main() -> None:
    d = get_json("https://open.er-api.com/v6/latest/USD", cache=False)
    if d.get("result") != "success":
        raise SystemExit(f"FX API error: {d}")
    rates = {k: (round(v, 6) if v < 100 else round(v, 2)) for k, v in sorted(d["rates"].items())}
    write_json("fx-snapshot.json", {
        "base": "USD",
        "asOf": d["time_last_update_utc"],
        "asOfUnix": d["time_last_update_unix"],
        "source": "ExchangeRate-API open access (https://open.er-api.com/v6/latest/USD) — Rates by Exchange Rate API",
        "rates": rates,
    })


if __name__ == "__main__":
    main()
