"""
ML API Router — Agri-SHIELD (/api/ml)
=====================================
Endpoints consumed by the web app (``apps/web/server/ml-client.ts``); request and
response fields are snake_case and match that contract field-for-field.

  POST /api/ml/flood-risk
  POST /api/ml/salinity-risk
  POST /api/ml/advisor
  POST /api/ml/supply-chain/scenario
  GET  /api/ml/metrics
  POST /api/ml/retrain          (X-API-Key when ML_API_KEY is set)
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from config import settings
from models.registry import registry
from models.salinity_predictor import CROP_TYPES
from models.supply_chain_impact import COMMODITIES, run_scenario
from rag.advisor import advisor
from services.ml_inference import predict_flood, predict_salinity

logger = logging.getLogger(__name__)
router = APIRouter()

CropType = Literal[CROP_TYPES]  # type: ignore[valid-type]
Language = Literal["en", "hi", "bn", "vi", "fil", "id", "ta", "si"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ─── Schemas ───────────────────────────────────────────────────────────────


class Point(_Strict):
    lat: float = Field(..., ge=-90, le=90, description="Latitude (WGS84)")
    lon: float = Field(..., ge=-180, le=180, description="Longitude (WGS84)")


class FloodRequest(Point):
    forecast_days: int = Field(3, ge=1, le=7)


class HourlyPoint(BaseModel):
    time: str
    precip_mm: float
    probability: float


class FloodResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    probability_24h: float = Field(..., ge=0, le=1)
    probability_48h: float = Field(..., ge=0, le=1)
    probability_72h: float = Field(..., ge=0, le=1)
    estimated_depth_m: float = Field(..., ge=0)
    confidence_interval: tuple[float, float]
    contributing_factors: list[str]
    risk_level: Literal["low", "medium", "high", "critical"]
    model_version: str
    hourly: list[HourlyPoint]


class SalinityRequest(Point):
    crop_type: CropType = "rice"
    prediction_horizon_days: int = Field(30, ge=1, le=90)


class SalinityResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ec_current: float
    ec_predicted_7d: float
    ec_predicted_30d: float
    risk_level: Literal["safe", "sensitive", "moderate", "severe"]
    crop_damage_probability: float = Field(..., ge=0, le=1)
    recommended_crops: list[str]
    mitigation_actions: list[str]
    confidence: float = Field(..., ge=0, le=1)
    model_version: str


class FarmerContext(_Strict):
    name: str = Field("", max_length=120)
    crops: list[str] = Field(default_factory=lambda: ["rice"], max_length=12)
    area_ha: float = Field(1.0, ge=0, le=100_000)
    district: str = Field("", max_length=120)
    country: str = Field("", max_length=60)
    flood_probability: float = Field(0.0, ge=0, le=100, description="0–1 (or 0–100 %)")
    salinity_ec: float = Field(0.0, ge=0, le=100, description="dS/m")
    forecast_summary: str = Field("", max_length=600)
    soil_type: Optional[str] = Field(None, max_length=60)

    @field_validator("crops")
    @classmethod
    def _lower(cls, v: list[str]) -> list[str]:
        return [c.strip().lower() for c in v if c and c.strip()]


class ChatTurn(_Strict):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class AdvisorRequest(_Strict):
    question: str = Field(..., min_length=2, max_length=1000)
    farmer_context: FarmerContext
    language: Language = "en"
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


class AdvisorAction(BaseModel):
    id: str
    label: str
    description: str
    urgency: str


class AdvisorSource(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str
    snippet: str


class AdvisorResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    answer: str
    actions: list[AdvisorAction]
    sources: list[AdvisorSource]
    confidence: float
    language: str
    provider: str


class ScenarioNode(_Strict):
    id: str = Field(..., min_length=1, max_length=80)
    flood_risk: float = Field(0.5, ge=0, le=1)
    capacity_tonnes: Optional[float] = Field(None, ge=0)


class ScenarioRequest(_Strict):
    commodity: str = Field("rice", max_length=40)
    region_ids: list[str] = Field(default_factory=lambda: ["bd-barisal"], min_length=1, max_length=50)
    intensity: int = Field(3, ge=1, le=5)
    duration_days: float = Field(7, gt=0, le=120)
    simulations: int = Field(2000, ge=100, le=20_000)
    baseline_volume_tonnes: Optional[float] = Field(None, gt=0)
    base_price_usd: Optional[float] = Field(None, gt=0)
    nodes: Optional[list[ScenarioNode]] = Field(None, max_length=200)
    seed: Optional[int] = None

    @field_validator("commodity")
    @classmethod
    def _commodity(cls, v: str) -> str:
        v = v.lower()
        if v not in COMMODITIES:
            raise ValueError(f"unsupported commodity '{v}'; use one of {sorted(COMMODITIES)}")
        return v


class ScenarioResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    disruption_probability: float
    volume_loss_tonnes: float
    volume_loss_ci: tuple[float, float]
    estimated_loss_usd: float
    loss_usd_ci: tuple[float, float]
    price_impact_pct: float
    recovery_days: int
    histogram: list[dict]
    affected_nodes: list[dict]


class RetrainRequest(_Strict):
    refresh_data: bool = Field(False, description="Append Open-Meteo ERA5/GloFAS days newer than the committed dataset")
    seed: Optional[int] = None
    force: bool = Field(False, description="Promote even if not better (admin override)")


# ─── Auth ──────────────────────────────────────────────────────────────────


async def require_api_key(x_api_key: Optional[str] = Header(None, alias="X-API-Key")) -> None:
    if settings.ml_api_key and not (x_api_key and secrets.compare_digest(x_api_key, settings.ml_api_key)):
        raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/flood-risk", response_model=FloodResponse)
async def flood_risk(req: FloodRequest):
    """72-hour flood probability (24/48/72 h), depth, 90 % interval, drivers and hourly curve."""
    try:
        return await predict_flood(req.lat, req.lon, req.forecast_days)
    except Exception as e:
        logger.exception("flood-risk failed")
        raise HTTPException(status_code=503, detail=f"flood prediction unavailable: {e}") from e


@router.post("/salinity-risk", response_model=SalinityResponse)
async def salinity_risk(req: SalinityRequest):
    """Root-zone EC now / +7 d / +30 d (+90 d), FAO risk class, crop damage, crops and mitigation."""
    try:
        return await predict_salinity(req.lat, req.lon, req.crop_type, req.prediction_horizon_days)
    except Exception as e:
        logger.exception("salinity-risk failed")
        raise HTTPException(status_code=503, detail=f"salinity prediction unavailable: {e}") from e


@router.post("/advisor", response_model=AdvisorResponse)
async def ask_advisor(req: AdvisorRequest):
    """RAG farm advisor: grounded markdown answer, action cards, cited sources."""
    return await advisor.answer(req.question, req.farmer_context.model_dump(), req.language, [h.model_dump() for h in req.history])


@router.post("/supply-chain/scenario", response_model=ScenarioResponse)
async def supply_chain_scenario(req: ScenarioRequest):
    """Monte Carlo flood-scenario impact on a commodity supply chain."""
    return await asyncio.to_thread(
        run_scenario,
        req.commodity,
        req.region_ids,
        req.intensity,
        req.duration_days,
        req.simulations,
        req.baseline_volume_tonnes,
        req.base_price_usd,
        [n.model_dump() for n in req.nodes] if req.nodes else None,
        req.seed,
    )


@router.get("/metrics")
async def model_metrics():
    """Held-out evaluation metrics of the deployed models (computed at training time)."""
    return registry.metrics_payload()


@router.post("/retrain", dependencies=[Depends(require_api_key)])
async def retrain(req: RetrainRequest = RetrainRequest()):
    """Spec §6 MODEL_RETRAIN: train candidate, compare on the held-out test set, promote only if better."""
    from models.data import datasets_available

    if not datasets_available():
        raise HTTPException(status_code=409, detail="training datasets missing — run scripts/train-models/build_dataset.py")
    return await asyncio.to_thread(registry.retrain, req.refresh_data, req.seed, req.force)
