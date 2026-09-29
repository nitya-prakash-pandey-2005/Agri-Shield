"""
Agri-SHIELD — model training
============================
Author: Nitya Prakash Pandey

Trains the flood ensemble and the salinity regressors from the committed
datasets (``apps/ml-api/data``), evaluates them on the held-out 2024–2025
period, and writes ``apps/ml-api/model_weights/{flood,salinity}.joblib`` plus
``metrics.json``.

Usage (from repo root):
  python scripts/train-models/build_dataset.py   # once, pulls open data
  python scripts/train-models/train.py           # ~30–60 s on a laptop
  python scripts/train-models/train.py --retrain # champion–challenger against deployed weights
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

ML_API = Path(__file__).resolve().parents[2] / "apps" / "ml-api"
sys.path.insert(0, str(ML_API))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--retrain", action="store_true", help="compare against deployed weights and promote only if better")
    ap.add_argument("--refresh-data", action="store_true", help="with --retrain: append newer Open-Meteo days first")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    from models.data import datasets_available
    from models.registry import registry

    if not datasets_available():
        sys.exit("datasets missing — run scripts/train-models/build_dataset.py first")
    t0 = time.time()
    if args.retrain:
        registry.load()
        decision = registry.retrain(refresh_data=args.refresh_data, seed=args.seed)
        print(json.dumps(decision, indent=2))
        return
    flood, sal = registry.train_candidates(seed=args.seed)
    registry._save(flood, sal)
    fm, sm = flood.metrics, sal.metrics
    print(f"\nTrained in {time.time() - t0:.1f}s")
    print(f"Flood ensemble {flood.version}  samples={fm['samples']}")
    for h in ("y1", "y2", "y3"):
        t = fm["test"][h]
        print(f"  {h}: AUC={t['auc']} F1@0.5={t['f1']} Brier={t['brier']} (pos rate {t['positive_rate']}) "
              f"components={fm['components_test'][h]} persistence={fm['baselines_test'][h]}")
    print(f"  onset (not flooding now) 72h: {fm['onset_test_y3']}")
    print(f"  depth head: {fm['depth']}  blend weights (MLP share): {fm['weights_mlp']}  PSI={fm['drift_psi']}")
    print(f"Salinity {sal.version}")
    for h, t in sm["test"].items():
        print(f"  {h}: {t}")
    print(f"  class precision 30d: {sm['class_precision_30d']}")


if __name__ == "__main__":
    main()
