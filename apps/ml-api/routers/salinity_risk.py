"""
Salinity Risk API Router — Agri-SHIELD
Uses SoilGrids soil texture + coastal proximity + rainfall deficit
to predict EC levels at 7d, 30d, 90d horizons.
"""
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import logging
import math

from services.soil_service import fetch_soil_data, salinity_risk_from_soil
from services.weather_service import fetch_weather_forecast, extract_24h_rainfall, extract_72h_rainfall

logger = logging.getLogger(__name__)
router = APIRouter()


class SalinityFactor(BaseModel):
    clay_percentage: float
    coastal_distance_km: float
    rainfall_deficit_mm: float
    organic_carbon_gkg: float
    drainage_class: int
    tidal_influence: float


class SalinityRiskResponse(BaseModel):
    """Stable contract — swap salinity model without frontend changes."""
    ec_current_dsm: float = Field(..., description="Estimated current EC (dS/m)")
    ec_7d_dsm: float = Field(..., description="Forecasted EC in 7 days")
    ec_30d_dsm: float = Field(..., description="Forecasted EC in 30 days")
    ec_90d_dsm: float = Field(..., description="Forecasted EC in 90 days")
    risk_level: str = Field(..., description="low | medium | high | critical")
    risk_score: float = Field(..., ge=0, le=100)
    confidence: float = Field(..., ge=0, le=1)
    crop_thresholds: dict = Field(..., description="EC threshold impact by crop type")
    factors: SalinityFactor
    recommended_actions: List[str]
    model_version: str
    data_sources: List[str]
    generated_at: datetime = Field(default_factory=datetime.utcnow)


@router.get("/predict", response_model=SalinityRiskResponse)
async def predict_salinity(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    coastal_distance_km: float = Query(50.0, description="Distance to coast in km"),
    crop_type: str = Query("rice", description="Primary crop: rice|wheat|vegetables|jute"),
    current_ec_dsm: Optional[float] = Query(None, description="Measured EC if available (dS/m)"),
):
    """
    Predict soil salinity (EC) for current and future time windows.
    
    Formula basis:
    - FAO AquaStat coastal EC model
    - SoilGrids clay/organic carbon for soil buffering capacity
    - Open-Meteo rainfall deficit for dilution estimation
    - Tidal influence factor by coastal distance
    """
    try:
        soil_data, weather_data = await __import__("asyncio").gather(
            fetch_soil_data(lat, lon),
            fetch_weather_forecast(lat, lon, forecast_days=7),
        )

        # Rainfall deficit = expected - actual (positive = deficit)
        rain_7d = extract_72h_rainfall(weather_data)  # Approximate
        typical_7d_rain = _get_typical_rainfall(lat, lon)
        rainfall_deficit = max(0, typical_7d_rain - rain_7d)

        ec_forecasts = salinity_risk_from_soil(soil_data, coastal_distance_km, rainfall_deficit)

        # Use measured EC if provided, else estimate
        clay = soil_data.get("clay_percentage", 35.0)
        base_ec = current_ec_dsm if current_ec_dsm else (0.5 + clay / 100 * 2.0)
        if coastal_distance_km < 30:
            base_ec *= (1 + (30 - coastal_distance_km) / 30 * 1.5)

        ec_current = round(min(base_ec, 15.0), 2)

        # Risk scoring from EC vs crop threshold
        threshold = _get_crop_ec_threshold(crop_type)
        risk_score = min(100, round((ec_forecasts["ec_7d_dsm"] / threshold) * 50, 1))
        risk_level = _ec_to_risk_level(ec_forecasts["ec_7d_dsm"], threshold)

        # Tidal influence (closer to coast = stronger tidal effect)
        tidal_influence = max(0, 1 - coastal_distance_km / 50.0)

        return {
            "ec_current_dsm": ec_current,
            **ec_forecasts,
            "risk_level": risk_level,
            "risk_score": risk_score,
            "confidence": 0.79 if not soil_data.get("_from_api") else 0.88,
            "crop_thresholds": {
                "rice": {"threshold_dsm": 3.0, "current_ratio": round(ec_current / 3.0, 2)},
                "wheat": {"threshold_dsm": 6.0, "current_ratio": round(ec_current / 6.0, 2)},
                "vegetables": {"threshold_dsm": 2.5, "current_ratio": round(ec_current / 2.5, 2)},
                "jute": {"threshold_dsm": 4.0, "current_ratio": round(ec_current / 4.0, 2)},
                "barley": {"threshold_dsm": 8.0, "current_ratio": round(ec_current / 8.0, 2)},
            },
            "factors": {
                "clay_percentage": soil_data.get("clay_percentage", 35.0),
                "coastal_distance_km": coastal_distance_km,
                "rainfall_deficit_mm": rainfall_deficit,
                "organic_carbon_gkg": soil_data.get("organic_carbon_gkg", 12.0),
                "drainage_class": soil_data.get("drainage_class", 3),
                "tidal_influence": round(tidal_influence, 3),
            },
            "recommended_actions": _get_salinity_actions(risk_level, crop_type, ec_forecasts["ec_7d_dsm"]),
            "model_version": "formula-salinity-v1.0.0",
            "data_sources": [
                "SoilGrids 2.0 (ISRIC, free)",
                "Open-Meteo historical rainfall (free)",
                "FAO AquaStat EC model",
                "Agri-SHIELD salinity formula v1.0",
            ],
            "generated_at": datetime.utcnow(),
        }

    except Exception as e:
        logger.error(f"Salinity prediction failed: {e}")
        raise HTTPException(status_code=500, detail="Salinity prediction service error")


def _get_crop_ec_threshold(crop_type: str) -> float:
    """FAO Table 4 — EC thresholds at 10% yield reduction."""
    thresholds = {
        "rice": 3.0,
        "wheat": 6.0,
        "vegetables": 2.5,
        "jute": 4.0,
        "barley": 8.0,
        "sugarcane": 5.9,
        "cotton": 7.7,
        "sorghum": 4.0,
    }
    return thresholds.get(crop_type.lower(), 4.0)


def _ec_to_risk_level(ec: float, threshold: float) -> str:
    ratio = ec / threshold
    if ratio < 0.5: return "low"
    if ratio < 0.8: return "medium"
    if ratio < 1.2: return "high"
    return "critical"


def _get_typical_rainfall(lat: float, lon: float) -> float:
    """7-day typical rainfall (mm) for key regions in wet/dry season."""
    # Bangladesh monsoon: ~70mm/7d; dry season: ~8mm/7d
    if 20 < lat < 26 and 88 < lon < 93:
        return 65.0
    if 9 < lat < 12 and 104 < lon < 108:  # Vietnam Mekong
        return 55.0
    return 40.0


def _get_salinity_actions(risk_level: str, crop: str, ec: float) -> List[str]:
    base = [f"Current EC estimate: {ec:.1f} dS/m"]
    if risk_level == "low":
        return base + ["Monitor monthly — conditions manageable", "Continue standard irrigation schedule"]
    elif risk_level == "medium":
        return base + [
            f"EC approaching {crop} tolerance threshold — monitor weekly",
            "Flush soil with freshwater irrigation if available (150mm over 2 days)",
            "Consider soil amendment: gypsum 1-2 t/ha improves Ca:Na ratio",
            "Avoid fertilizers that add Na (KCl, NaNO3)",
        ]
    elif risk_level == "high":
        return base + [
            f"⚠️ EC exceeds safe limit for {crop} — yield reduction likely",
            "Apply gypsum: 2-4 t/ha immediately",
            "Irrigate with freshwater: minimum 200mm in 3-day flush",
            f"Consider switching to salt-tolerant variety (e.g., BRRI dhan 47/67 for rice)",
            "Contact local DAE extension officer for soil testing",
        ]
    else:  # critical
        return base + [
            f"🚨 Critical salinity — {crop} likely to fail this season",
            "Do NOT plant rice — EC > threshold for profitable yield",
            "Options: barley (tolerates 8 dS/m), cotton (7.7 dS/m), sorghum (4.0 dS/m)",
            "Apply heavy gypsum: 4-6 t/ha + 300mm freshwater flush",
            "Government subsidy for gypsum available through DAE — apply now",
            "Consider aquaculture conversion (shrimp ponds profitable at EC 5-15 dS/m)",
        ]
