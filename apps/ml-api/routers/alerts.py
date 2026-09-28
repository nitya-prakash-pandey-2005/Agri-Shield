from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import logging
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateAlertRequest(BaseModel):
    alert_type: str = Field(..., description="flood|salinity|drought|storm|frost")
    severity: str = Field(..., description="watch|warning|emergency")
    region_id: str
    flood_probability: Optional[float] = None
    salinity_ec_dsm: Optional[float] = None
    affected_farmers: Optional[int] = None
    recommended_actions: Optional[List[str]] = None
    channels: List[str] = Field(default=["sms", "app"], description="sms|whatsapp|email|app")
    language: str = Field(default="en")


class AlertResponse(BaseModel):
    id: str
    alert_type: str
    severity: str
    title: str
    description: str
    recommended_actions: List[str]
    valid_from: datetime
    valid_until: datetime
    channels_dispatched: List[str]
    estimated_recipients: int
    model_version: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)


ALERT_TEMPLATES = {
    "flood": {
        "watch": {
            "title": "Flood Watch — {region}",
            "description": "Elevated rainfall expected. River levels rising. {prob:.0f}% flood probability in 72 hours. Monitor conditions closely.",
        },
        "warning": {
            "title": "⚠️ Flood Warning — {region}",
            "description": "Significant flooding likely in 24-72 hours. {prob:.0f}% probability. Immediate crop and equipment protection measures recommended.",
        },
        "emergency": {
            "title": "🚨 FLOOD EMERGENCY — {region}",
            "description": "Severe flooding imminent. {prob:.0f}% probability in 24 hours. EVACUATE low-lying farm areas. Contact emergency services immediately.",
        },
    },
    "salinity": {
        "watch": {
            "title": "Salinity Watch — {region}",
            "description": "EC levels trending upward ({ec:.1f} dS/m). Monitor irrigation water quality. Salt-tolerant varieties recommended.",
        },
        "warning": {
            "title": "⚠️ Salinity Alert — {region}",
            "description": "Soil EC at {ec:.1f} dS/m — approaching crop damage threshold. Apply freshwater flush and gypsum amendment.",
        },
        "emergency": {
            "title": "🚨 Critical Salinity — {region}",
            "description": "EC at {ec:.1f} dS/m — severe crop damage likely. Do not plant susceptible crops. Switch to salt-tolerant varieties immediately.",
        },
    },
}

DEFAULT_ACTIONS = {
    "flood": {
        "watch": ["Monitor weather updates", "Clear drainage channels", "Prepare emergency contacts"],
        "warning": ["Harvest mature crops immediately", "Move equipment to high ground", "Deploy pumps on drainage channels"],
        "emergency": ["EVACUATE low-lying areas now", "Contact emergency services", "Document all damage for insurance"],
    },
    "salinity": {
        "watch": ["Monitor EC levels weekly", "Reduce irrigation from saline sources", "Consider gypsum application"],
        "warning": ["Apply freshwater flush (150mm over 3 days)", "Apply gypsum 2-4 t/ha", "Switch to salt-tolerant varieties"],
        "emergency": ["Stop planting susceptible crops", "Apply emergency gypsum treatment", "Contact agricultural extension officer"],
    },
}


@router.post("/generate", response_model=AlertResponse)
async def generate_alert(request: GenerateAlertRequest):
    """
    Generate a context-aware alert from climate risk inputs.
    
    In production: alerts are stored in DB and dispatched via Twilio/FCM.
    Here we generate the alert content and return the contract.
    """
    templates = ALERT_TEMPLATES.get(request.alert_type, ALERT_TEMPLATES["flood"])
    template = templates.get(request.severity, templates["watch"])

    prob = request.flood_probability or 0.5
    ec = request.salinity_ec_dsm or 3.5

    title = template["title"].format(
        region=request.region_id.replace("_", " ").title(),
        prob=prob * 100,
    )
    description = template["description"].format(
        region=request.region_id.replace("_", " ").title(),
        prob=prob * 100,
        ec=ec,
    )

    actions = request.recommended_actions or DEFAULT_ACTIONS.get(
        request.alert_type, {}
    ).get(request.severity, ["Monitor conditions closely"])

    valid_hours = {"watch": 120, "warning": 72, "emergency": 24}.get(request.severity, 72)

    return {
        "id": str(uuid.uuid4()),
        "alert_type": request.alert_type,
        "severity": request.severity,
        "title": title,
        "description": description,
        "recommended_actions": actions,
        "valid_from": datetime.utcnow(),
        "valid_until": datetime.utcnow() + timedelta(hours=valid_hours),
        "channels_dispatched": request.channels,
        "estimated_recipients": request.affected_farmers or 1000,
        "model_version": "alert-engine-v1.0.0",
        "generated_at": datetime.utcnow(),
    }


@router.get("/templates")
async def list_alert_templates():
    """List all available alert templates and their variables."""
    return {
        "templates": list(ALERT_TEMPLATES.keys()),
        "severity_levels": ["watch", "warning", "emergency"],
        "channels": ["sms", "whatsapp", "email", "app", "radio"],
        "languages": ["en", "hi", "bn", "vi", "fil", "id", "ta", "si"],
    }
