from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager
import uvicorn
import logging

from routers import (
    flood_risk,
    salinity_risk,
    crop_health,
    supply_chain,
    alerts,
    weather,
    health,
)
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("🌾 Agri-SHIELD ML API starting up...")
    logger.info(f"Environment: {settings.environment}")
    yield
    logger.info("Agri-SHIELD ML API shutting down.")


app = FastAPI(
    title="Agri-SHIELD ML API",
    description="""
    AI-powered climate decision intelligence API for Agri-SHIELD platform.
    
    Provides:
    - **Flood Risk Prediction**: 24h/48h/72h flood probability using domain formulas + Open-Meteo weather data
    - **Salinity Intrusion Forecasting**: EC level predictions using SoilGrids + tidal/rainfall models
    - **Crop Health Scoring**: NDVI-based field health with satellite imagery analysis  
    - **Supply Chain Risk**: Commodity disruption probability and price impact forecasting
    - **Alert Engine**: Multi-tier, multi-channel alert generation and delivery
    
    All endpoints return predictions with confidence intervals.
    JSON response shapes are versioned and stable for model swapping.
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Routers
app.include_router(health, prefix="/health", tags=["Health"])
app.include_router(weather, prefix="/api/v1/weather", tags=["Weather"])
app.include_router(flood_risk, prefix="/api/v1/flood-risk", tags=["Flood Risk"])
app.include_router(salinity_risk, prefix="/api/v1/salinity", tags=["Salinity"])
app.include_router(crop_health, prefix="/api/v1/crop-health", tags=["Crop Health"])
app.include_router(supply_chain, prefix="/api/v1/supply-chain", tags=["Supply Chain"])
app.include_router(alerts, prefix="/api/v1/alerts", tags=["Alerts"])


@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "Agri-SHIELD ML API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(settings.port),
        reload=settings.environment == "development",
        workers=1 if settings.environment == "development" else 4,
    )
