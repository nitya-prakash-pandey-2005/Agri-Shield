"""
SoilGrids 2.0 Service — Agri-SHIELD
=====================================
Fetches soil properties from ISRIC SoilGrids REST API (free, no API key required).

Data used in risk models:
- Clay content (%) → drainage/permeability
- Silt content (%) → erosion risk
- Organic carbon (g/kg) → soil health baseline
- Bulk density (cg/cm3) → compaction
- pH (10^-3) → nutrient availability
- Drainage class → flood risk amplifier
"""
import httpx
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

SOILGRIDS_BASE = "https://rest.isric.org/soilgrids/v2.0"

# Standard depth intervals used in risk calculations
# "0-5cm" for surface risk, "5-15cm" for root zone
SOIL_PROPERTIES = {
    "clay": "clay",          # Clay content (g/kg)
    "silt": "silt",          # Silt content (g/kg)
    "sand": "sand",          # Sand content (g/kg)
    "ocd": "ocd",            # Organic carbon density (g/dm3)
    "phh2o": "phh2o",        # pH in H2O (10^-3)
    "bdod": "bdod",          # Bulk density (cg/cm3)
}


async def fetch_soil_data(lat: float, lon: float) -> Dict[str, Any]:
    """
    Fetch soil property data from SoilGrids REST API.
    
    Returns standardized soil dict with values normalized for risk formulas.
    Falls back to South Asia typical values if API unavailable.
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            # Query point data for 0-5cm depth
            params = {
                "lon": lon,
                "lat": lat,
                "property": list(SOIL_PROPERTIES.values()),
                "depth": "0-5cm",
                "value": "mean",
            }
            resp = await client.get(
                f"{SOILGRIDS_BASE}/properties/query",
                params=params,
            )
            resp.raise_for_status()
            raw = resp.json()
            return _parse_soilgrids_response(raw)

    except httpx.HTTPStatusError as e:
        logger.warning(f"SoilGrids HTTP {e.response.status_code} for ({lat},{lon}). Using defaults.")
        return _regional_soil_defaults(lat, lon)
    except Exception as e:
        logger.warning(f"SoilGrids fetch failed: {e}. Using regional defaults.")
        return _regional_soil_defaults(lat, lon)


def _parse_soilgrids_response(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Parse SoilGrids v2.0 response format."""
    result = {}

    try:
        properties = raw.get("properties", {}).get("layers", [])

        for layer in properties:
            name = layer.get("name", "")
            depths = layer.get("depths", [])

            if not depths:
                continue

            # Get 0-5cm value
            depth = depths[0]
            mean_val = depth.get("values", {}).get("mean")

            if mean_val is None:
                continue

            if name == "clay":
                # Clay in g/kg → percentage
                result["clay_percentage"] = round(float(mean_val) / 10.0, 1)
            elif name == "silt":
                result["silt_percentage"] = round(float(mean_val) / 10.0, 1)
            elif name == "sand":
                result["sand_percentage"] = round(float(mean_val) / 10.0, 1)
            elif name == "phh2o":
                # pH in 10^-3 units → standard pH
                result["ph"] = round(float(mean_val) / 10.0, 1)
            elif name == "bdod":
                # Bulk density in cg/cm3 → g/cm3
                result["bulk_density"] = round(float(mean_val) / 100.0, 2)
            elif name == "ocd":
                result["organic_carbon_gkg"] = round(float(mean_val), 1)

    except (KeyError, TypeError, ValueError) as e:
        logger.error(f"Failed to parse SoilGrids response: {e}")
        return _regional_soil_defaults(0, 0)

    # Derive drainage class from texture
    if "clay_percentage" in result:
        result["drainage_class"] = _derive_drainage_class(result)
        result["_from_api"] = True

    return result


def _derive_drainage_class(soil: Dict[str, Any]) -> int:
    """
    Estimate drainage class from soil texture.
    
    Based on USDA soil drainage classification:
    - High clay + low sand → poorly drained (class 2-3)
    - Sandy soils → well to excessively drained (class 5-7)
    """
    clay = soil.get("clay_percentage", 35.0)
    sand = soil.get("sand_percentage", 25.0)
    
    if clay > 55: return 1   # Very poorly drained (heavy clay)
    if clay > 40: return 2   # Poorly drained
    if clay > 30: return 3   # Somewhat poorly drained
    if clay > 20: return 4   # Moderately well drained
    if sand > 60: return 6   # Somewhat excessively drained
    if sand > 80: return 7   # Excessively drained
    return 4                 # Moderately well drained (default)


def _regional_soil_defaults(lat: float, lon: float) -> Dict[str, Any]:
    """
    Regional soil property defaults based on geographic location.
    
    Calibrated from FAO/ISRIC global soil databases for key risk regions:
    - Bangladesh delta: high clay, poorly drained
    - Vietnam Mekong: moderate clay, moderate drainage  
    - Philippines volcanic: moderate clay, well drained
    - India coastal plains: variable
    """
    # Bangladesh / low Bengal delta
    if 20 < lat < 26 and 88 < lon < 93:
        return {
            "clay_percentage": 42.0,
            "silt_percentage": 35.0,
            "sand_percentage": 23.0,
            "drainage_class": 2,  # Poorly drained
            "organic_carbon_gkg": 15.0,
            "ph": 6.8,
            "bulk_density": 1.28,
            "_from_api": False,
            "_region": "Bangladesh_delta",
        }

    # Vietnam Mekong Delta
    if 9 < lat < 12 and 104 < lon < 108:
        return {
            "clay_percentage": 38.0,
            "silt_percentage": 40.0,
            "sand_percentage": 22.0,
            "drainage_class": 3,  # Somewhat poorly drained
            "organic_carbon_gkg": 22.0,
            "ph": 5.4,  # Acid sulfate soils common in Mekong
            "bulk_density": 1.20,
            "_from_api": False,
            "_region": "Vietnam_Mekong",
        }

    # Philippines (Luzon)
    if 14 < lat < 18 and 119 < lon < 123:
        return {
            "clay_percentage": 35.0,
            "silt_percentage": 30.0,
            "sand_percentage": 35.0,
            "drainage_class": 4,  # Moderately well drained
            "organic_carbon_gkg": 18.0,
            "ph": 6.2,
            "bulk_density": 1.35,
            "_from_api": False,
            "_region": "Philippines_Luzon",
        }

    # India coastal plains (Odisha/AP)
    if 14 < lat < 22 and 79 < lon < 86:
        return {
            "clay_percentage": 36.0,
            "silt_percentage": 32.0,
            "sand_percentage": 32.0,
            "drainage_class": 3,
            "organic_carbon_gkg": 8.0,
            "ph": 7.2,
            "bulk_density": 1.45,
            "_from_api": False,
            "_region": "India_coastal",
        }

    # Generic South/Southeast Asia default
    return {
        "clay_percentage": 35.0,
        "silt_percentage": 32.0,
        "sand_percentage": 33.0,
        "drainage_class": 3,
        "organic_carbon_gkg": 12.0,
        "ph": 6.5,
        "bulk_density": 1.35,
        "_from_api": False,
        "_region": "generic_SEA",
    }


def salinity_risk_from_soil(
    soil_data: Dict[str, Any],
    coastal_distance_km: float,
    rainfall_deficit_mm: float,
) -> Dict[str, float]:
    """
    Estimate salinity intrusion risk from soil texture + proximity.
    
    Based on FAO Irrigation and Drainage Paper 29 (soil salinity thresholds).
    Returns EC estimates (dS/m) for 7d, 30d, 90d horizons.
    
    EC threshold impacts:
    - Rice: EC > 3.0 dS/m → yield reduction begins
    - Rice: EC > 6.0 dS/m → 50% yield loss
    - Wheat: EC > 6.0 dS/m → yield reduction begins
    - Vegetables: EC > 2.5 dS/m → sensitive crops affected
    """
    clay = soil_data.get("clay_percentage", 35.0)
    organic_carbon = soil_data.get("organic_carbon_gkg", 12.0)

    # Base EC from soil texture (clay retains salts)
    base_ec = 0.5 + (clay / 100.0) * 2.0

    # Coastal proximity amplifier
    if coastal_distance_km < 10:
        coastal_amp = 3.5
    elif coastal_distance_km < 30:
        coastal_amp = 2.0
    elif coastal_distance_km < 60:
        coastal_amp = 1.2
    else:
        coastal_amp = 0.8

    # Rainfall deficit worsens salinity (less dilution)
    deficit_factor = 1 + max(0, rainfall_deficit_mm / 200.0)

    # Organic carbon slightly buffers salinity (soil structure)
    oc_buffer = 1 - min(organic_carbon / 50.0, 0.3)

    ec_7d = base_ec * coastal_amp * deficit_factor * oc_buffer
    ec_30d = ec_7d * 1.15   # salinity tends to worsen without rainfall
    ec_90d = ec_7d * 1.30

    return {
        "ec_7d_dsm": round(min(ec_7d, 15.0), 2),
        "ec_30d_dsm": round(min(ec_30d, 15.0), 2),
        "ec_90d_dsm": round(min(ec_90d, 15.0), 2),
    }
