"""
Flood Risk API Router — Agri-SHIELD
=====================================
GET /api/v1/flood-risk/predict    — Point-level flood risk prediction
POST /api/v1/flood-risk/batch     — Batch prediction for multiple farm locations
GET /api/v1/flood-risk/forecast   — 72h hourly flood probability timeline
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
import logging

from services.flood_risk_engine import flood_engine

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Request / Response Models ──────────────────────────────────────────────

class FloodFactor(BaseModel):
    rainfall_24h_mm: float
    rainfall_48h_mm: float
    rainfall_72h_mm: float
    soil_moisture: float
    drainage_factor: float
    clay_percentage: float
    elevation_factor: float
    river_proximity_factor: float
    coastal_proximity_factor: float
    historical_flood_factor: float


class ForecastHour(BaseModel):
    hour: int
    precip_mm: float
    cumulative_precip_mm: float
    flood_probability: float


class FloodRiskResponse(BaseModel):
    """
    Stable contract — JSON shape does not change when ML model is swapped.
    All fields always present. Model version tracked in model_version field.
    """
    probability_24h: float = Field(..., ge=0, le=1, description="24h flood probability (0-1)")
    probability_48h: float = Field(..., ge=0, le=1)
    probability_72h: float = Field(..., ge=0, le=1)
    risk_level: str = Field(..., description="low | medium | high | critical")
    risk_score: float = Field(..., ge=0, le=100, description="0-100 composite risk score")
    confidence: float = Field(..., ge=0, le=1, description="Model confidence (0-1)")
    factors: FloodFactor
    forecast_hours: List[ForecastHour]
    recommended_actions: List[str]
    model_version: str = Field(..., description="e.g. formula-v1.0.0 or lstm-v2.1.0")
    data_sources: List[str]
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    location: dict = Field(default_factory=dict)


class BatchFloodRequest(BaseModel):
    locations: List[dict] = Field(
        ...,
        description="List of location objects with lat, lon, and optional farm metadata",
        max_length=50,  # Max 50 per batch
    )

    @field_validator("locations")
    @classmethod
    def validate_locations(cls, v):
        for loc in v:
            if "lat" not in loc or "lon" not in loc:
                raise ValueError("Each location must have lat and lon")
            if not (-90 <= loc["lat"] <= 90):
                raise ValueError(f"Invalid latitude: {loc['lat']}")
            if not (-180 <= loc["lon"] <= 180):
                raise ValueError(f"Invalid longitude: {loc['lon']}")
        return v


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get(
    "/predict",
    response_model=FloodRiskResponse,
    summary="Predict flood risk for a GPS location",
    description="""
    Returns flood probability for 24h, 48h, and 72h windows using:
    - Open-Meteo real-time rainfall forecast (free API)
    - SoilGrids soil drainage/texture data (free API)
    - Domain formula scoring (SCS Curve Number + logistic calibration)
    
    Model version tracked so trained ML model can replace formula without frontend changes.
    """,
)
async def predict_flood_risk(
    lat: float = Query(..., ge=-90, le=90, description="Latitude (WGS84)"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude (WGS84)"),
    elevation_m: float = Query(5.0, ge=0, le=5000, description="Elevation in meters"),
    river_distance_km: float = Query(3.0, ge=0, le=500, description="Distance to nearest river (km)"),
    coastal_distance_km: float = Query(50.0, ge=0, le=5000, description="Distance to coast (km)"),
    historical_flood_years: int = Query(3, ge=0, le=10, description="Flood events in last 10 years"),
    farmer_reported_risk: Optional[bool] = Query(None, description="Farmer-reported flood history"),
):
    """Main flood risk prediction endpoint."""
    try:
        result = await flood_engine.predict(
            lat=lat,
            lon=lon,
            elevation_m=elevation_m,
            river_distance_km=river_distance_km,
            coastal_distance_km=coastal_distance_km,
            historical_flood_years=historical_flood_years,
            farmer_reported_risk=farmer_reported_risk,
        )

        # Remove internal cache timestamp
        result.pop("_ts", None)

        return {
            **result,
            "generated_at": datetime.utcnow(),
            "location": {
                "lat": lat,
                "lon": lon,
                "elevation_m": elevation_m,
                "river_distance_km": river_distance_km,
                "coastal_distance_km": coastal_distance_km,
            },
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Flood prediction failed for ({lat},{lon}): {e}")
        raise HTTPException(status_code=500, detail="Flood risk prediction service error")


@router.post(
    "/batch",
    response_model=List[dict],
    summary="Batch flood risk prediction for multiple locations",
)
async def batch_flood_risk(request: BatchFloodRequest):
    """Batch prediction — useful for government dashboards processing many districts."""
    import asyncio
    
    tasks = []
    for loc in request.locations:
        tasks.append(
            flood_engine.predict(
                lat=loc["lat"],
                lon=loc["lon"],
                elevation_m=loc.get("elevation_m", 5.0),
                river_distance_km=loc.get("river_distance_km", 3.0),
                coastal_distance_km=loc.get("coastal_distance_km", 50.0),
                historical_flood_years=loc.get("historical_flood_years", 3),
            )
        )

    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = []
    for i, (loc, result) in enumerate(zip(request.locations, results)):
        if isinstance(result, Exception):
            output.append({
                "location": loc,
                "error": str(result),
                "status": "failed",
            })
        else:
            result.pop("_ts", None)
            output.append({
                "location": loc,
                "prediction": result,
                "status": "ok",
            })

    return output


@router.get(
    "/forecast",
    response_model=List[ForecastHour],
    summary="72h hourly flood probability timeline",
)
async def flood_probability_forecast(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    elevation_m: float = Query(5.0),
    river_distance_km: float = Query(3.0),
):
    """Returns 72 hourly flood probability data points for chart visualization."""
    try:
        result = await flood_engine.predict(
            lat=lat,
            lon=lon,
            elevation_m=elevation_m,
            river_distance_km=river_distance_km,
        )
        return result.get("forecast_hours", [])
    except Exception as e:
        logger.error(f"Forecast endpoint failed: {e}")
        raise HTTPException(status_code=500, detail="Forecast service error")
