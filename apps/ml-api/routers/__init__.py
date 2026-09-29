from .flood_risk import router as flood_risk
from .salinity_risk import router as salinity_risk
from .crop_health import router as crop_health
from .supply_chain import router as supply_chain
from .alerts import router as alerts
from .weather import router as weather
from .health import router as health
from .ml import router as ml

__all__ = [
    "flood_risk",
    "salinity_risk",
    "crop_health",
    "supply_chain",
    "alerts",
    "weather",
    "health",
    "ml",
]
