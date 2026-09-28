from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import math
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class CropHealthResponse(BaseModel):
    """Stable contract for crop health / NDVI scoring."""
    ndvi_score: float = Field(..., ge=-1, le=1, description="NDVI value (-1 to 1)")
    health_category: str = Field(..., description="excellent | good | fair | poor | critical")
    health_score: float = Field(..., ge=0, le=100)
    stress_factors: dict
    estimated_yield_impact_pct: float = Field(..., description="% yield change vs healthy baseline")
    recommendations: List[str]
    model_version: str
    data_source: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)


@router.get("/score", response_model=CropHealthResponse)
async def get_crop_health(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    crop_type: str = Query("rice"),
    growth_stage: str = Query("vegetative", description="vegetative|tillering|flowering|grain_fill|mature"),
    flood_exposure_days: int = Query(0, ge=0, le=30, description="Days of submergence"),
    salinity_ec_dsm: float = Query(0.0, ge=0, description="Current soil EC (dS/m)"),
    drought_stress_days: int = Query(0, ge=0, le=60),
):
    """
    Estimate crop health score using domain formula approach.
    
    In production: replace with real Sentinel-2 NDVI from satellite API.
    Current approach uses growth-stage-adjusted stress model:
    - FAO crop stress functions (Ks) for water/salinity
    - NDVI benchmarks from IRRI rice crop database
    - Stage-sensitive stress multipliers
    """
    # Baseline NDVI by growth stage (IRRI benchmarks)
    ndvi_by_stage = {
        "vegetative": 0.55,
        "tillering": 0.70,
        "flowering": 0.75,
        "grain_fill": 0.65,
        "mature": 0.45,
    }
    base_ndvi = ndvi_by_stage.get(growth_stage, 0.65)

    # Stress factors (FAO Ks functions)
    # 1. Flood stress
    flood_ks = max(0.0, 1.0 - (flood_exposure_days / 14.0) * 0.6)
    if flood_exposure_days > 10:
        flood_ks *= 0.5  # severe penalty above 10 days

    # 2. Salinity stress (van Genuchten model)
    ec_threshold = {"rice": 3.0, "wheat": 6.0, "vegetables": 2.5}.get(crop_type, 4.0)
    ec_slope = 0.12  # % yield loss per dS/m above threshold
    if salinity_ec_dsm > ec_threshold:
        salinity_ks = max(0.1, 1.0 - ec_slope * (salinity_ec_dsm - ec_threshold))
    else:
        salinity_ks = 1.0

    # 3. Drought stress (simplified FAO-56)
    drought_ks = max(0.2, 1.0 - (drought_stress_days / 30.0) * 0.4)

    # Combine stresses multiplicatively
    combined_ks = flood_ks * salinity_ks * drought_ks
    actual_ndvi = round(base_ndvi * combined_ks, 3)

    # Health category
    if actual_ndvi > 0.65: cat = "excellent"
    elif actual_ndvi > 0.50: cat = "good"
    elif actual_ndvi > 0.35: cat = "fair"
    elif actual_ndvi > 0.20: cat = "poor"
    else: cat = "critical"

    health_score = round(actual_ndvi * 100 * combined_ks, 1)

    # Yield impact
    yield_impact = round((combined_ks - 1.0) * 100, 1)

    return {
        "ndvi_score": actual_ndvi,
        "health_category": cat,
        "health_score": min(health_score, 100),
        "stress_factors": {
            "flood_stress_ks": round(flood_ks, 3),
            "salinity_stress_ks": round(salinity_ks, 3),
            "drought_stress_ks": round(drought_ks, 3),
            "combined_stress_ks": round(combined_ks, 3),
            "flood_exposure_days": flood_exposure_days,
            "salinity_ec_dsm": salinity_ec_dsm,
            "drought_stress_days": drought_stress_days,
        },
        "estimated_yield_impact_pct": yield_impact,
        "recommendations": _crop_health_recommendations(cat, crop_type, combined_ks),
        "model_version": "formula-crop-health-v1.0.0",
        "data_source": "FAO-56 stress functions + IRRI NDVI benchmarks",
        "generated_at": datetime.utcnow(),
    }


def _crop_health_recommendations(category: str, crop: str, ks: float) -> List[str]:
    if category == "excellent":
        return ["Crop is healthy — maintain current practices", "No stress indicators detected"]
    elif category == "good":
        return ["Minor stress detected — monitor weekly", "Apply balanced NPK if leaves show yellowing"]
    elif category == "fair":
        return [
            f"Moderate stress affecting {crop} yield",
            "Apply nitrogen top-dressing (30 kg N/ha)",
            "Ensure adequate irrigation schedule",
            "Scout for pest/disease pressure",
        ]
    elif category == "poor":
        return [
            f"Significant yield loss expected for {crop}",
            "Immediate intervention required",
            "Contact extension officer for assessment",
            "Consider harvest if > 80% mature",
            "Document for crop insurance claim",
        ]
    else:  # critical
        return [
            f"🚨 Critical crop failure risk for {crop}",
            "Emergency harvest of any mature areas",
            "Contact government agriculture department",
            "File crop insurance claim immediately",
            f"Stress factor: {round((1-ks)*100, 0)}% yield reduction expected",
        ]
