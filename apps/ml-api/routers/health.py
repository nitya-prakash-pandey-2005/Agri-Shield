"""
Health endpoints — Agri-SHIELD ML API
``GET /health`` and ``GET /health/`` return {status, version, models_loaded, uptime_s}.
"""
import sys
import time
from datetime import datetime, timezone

from fastapi import APIRouter

from config import settings
from models.registry import registry

router = APIRouter()


def _payload() -> dict:
    return {
        "status": "healthy" if registry.ready else "degraded",
        "version": settings.version,
        "models_loaded": registry.models_loaded(),
        "uptime_s": round(time.monotonic() - registry.started, 1),
        "model_status": registry.status,
        "model_versions": {
            "flood": getattr(registry.flood, "version", None),
            "salinity": getattr(registry.salinity, "version", None),
        },
        "service": "Agri-SHIELD ML API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "python_version": sys.version.split()[0],
    }


@router.get("")
@router.get("/")
async def health_check():
    return _payload()


@router.get("/ready")
async def readiness():
    """Readiness probe: true once trained models are serving (formula fallback before that)."""
    return {"ready": registry.ready, "model_status": registry.status}


@router.get("/live")
async def liveness():
    """Liveness probe."""
    return {"alive": True}
