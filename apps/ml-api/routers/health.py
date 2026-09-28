from fastapi import APIRouter
from datetime import datetime
import sys

router = APIRouter()

@router.get("/")
async def health_check():
    return {
        "status": "healthy",
        "service": "Agri-SHIELD ML API",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "python_version": sys.version,
        "checks": {
            "weather_api": "open-meteo (free, no key)",
            "soil_api": "soilgrids-v2 (free, no key)",
            "model_engine": "domain-formula-v1.0",
        },
    }

@router.get("/ready")
async def readiness():
    """Kubernetes readiness probe."""
    return {"ready": True}

@router.get("/live")
async def liveness():
    """Kubernetes liveness probe."""
    return {"alive": True}
