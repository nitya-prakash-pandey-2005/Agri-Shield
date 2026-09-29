"""
Agri-SHIELD ML API — FastAPI entry point.
Run: ``cd apps/ml-api && python -m uvicorn main:app --port 8000``
"""
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from config import settings
from models.registry import registry
from routers import (
    alerts,
    crop_health,
    flood_risk,
    health,
    ml,
    salinity_risk,
    supply_chain,
    weather,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: load trained weights, or train them in the background from the committed dataset."""
    logger.info("Agri-SHIELD ML API %s starting (%s)", settings.version, settings.environment)
    if not registry.load() and settings.train_on_startup:
        registry.start_background_training()
    try:
        from rag.retriever import get_retriever

        get_retriever()  # warm the knowledge-base index
    except Exception as e:
        logger.warning("Knowledge base failed to load: %s", e)
    yield
    from services.live_data import close_http

    await close_http()
    logger.info("Agri-SHIELD ML API shutting down.")


app = FastAPI(
    title="Agri-SHIELD ML API",
    description="""
    AI climate decision-intelligence API for the Agri-SHIELD platform.

    - **Flood risk** (`/api/ml/flood-risk`): 24/48/72 h probability from a temporal-MLP + HistGBM ensemble
      trained on ERA5 reanalysis and GloFAS river discharge, Monte Carlo uncertainty, depth head.
    - **Salinity** (`/api/ml/salinity-risk`): root-zone EC now/+7/+30/+90 days, FAO crop damage.
    - **Farm advisor** (`/api/ml/advisor`): retrieval-augmented, multilingual, cites sources.
    - **Supply chain** (`/api/ml/supply-chain/scenario`): Monte Carlo commodity disruption scenarios.
    - **Metrics / retrain** (`/api/ml/metrics`, `/api/ml/retrain`): held-out metrics, champion–challenger promotion.

    Live inputs: Open-Meteo forecast/flood/marine/elevation (CC BY 4.0), ISRIC SoilGrids.
    Legacy formula endpoints remain under `/api/v1/*`.
    """,
    version=settings.version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """Consistent 422 body: {error, detail[]}."""
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "detail": [{"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "message": e.get("msg"), "type": e.get("type")} for e in exc.errors()],
        },
    )


# Routers
app.include_router(health, prefix="/health", tags=["Health"])
app.include_router(ml, prefix="/api/ml", tags=["ML (web contract)"])
app.include_router(weather, prefix="/api/v1/weather", tags=["Weather"])
app.include_router(flood_risk, prefix="/api/v1/flood-risk", tags=["Flood Risk (formula)"])
app.include_router(salinity_risk, prefix="/api/v1/salinity", tags=["Salinity (formula)"])
app.include_router(crop_health, prefix="/api/v1/crop-health", tags=["Crop Health"])
app.include_router(supply_chain, prefix="/api/v1/supply-chain", tags=["Supply Chain"])
app.include_router(alerts, prefix="/api/v1/alerts", tags=["Alerts"])


@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "Agri-SHIELD ML API",
        "version": settings.version,
        "status": "operational",
        "models": registry.status,
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(settings.port),
        reload=settings.environment == "development",
        workers=1,
    )
