"""
Weather data service using Open-Meteo API (free, no API key required).
Provides hourly forecasts and historical data for flood/salinity risk modeling.
"""
import httpx
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

OPEN_METEO_BASE = "https://api.open-meteo.com/v1"

# Open-Meteo variable codes
HOURLY_VARS = [
    "precipitation",
    "rain",
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "surface_pressure",
    "et0_fao_evapotranspiration",
    "soil_moisture_0_to_7cm",
    "soil_moisture_7_to_28cm",
]

DAILY_VARS = [
    "precipitation_sum",
    "rain_sum",
    "precipitation_probability_max",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
    "et0_fao_evapotranspiration",
]


async def fetch_weather_forecast(
    lat: float,
    lon: float,
    forecast_days: int = 7,
    past_days: int = 2,
) -> Dict[str, Any]:
    """
    Fetch weather forecast from Open-Meteo API.
    
    Returns both hourly and daily data for the specified location.
    Includes past_days of historical data for baseline comparison.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(HOURLY_VARS),
        "daily": ",".join(DAILY_VARS),
        "forecast_days": forecast_days,
        "past_days": past_days,
        "timezone": "auto",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{OPEN_METEO_BASE}/forecast", params=params)
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"Fetched Open-Meteo forecast for ({lat}, {lon}): {forecast_days}d")
            return data
    except httpx.HTTPStatusError as e:
        logger.error(f"Open-Meteo HTTP error: {e.response.status_code}")
        return _simulated_weather_data(lat, lon, forecast_days)
    except Exception as e:
        logger.error(f"Open-Meteo fetch failed: {e}. Using simulated data.")
        return _simulated_weather_data(lat, lon, forecast_days)


async def fetch_historical_weather(
    lat: float,
    lon: float,
    start_date: str,  # YYYY-MM-DD
    end_date: str,
) -> Dict[str, Any]:
    """
    Fetch historical weather data from Open-Meteo Historical API.
    Used for calculating rainfall accumulation baselines.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": ",".join(DAILY_VARS),
        "timezone": "auto",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://archive-api.open-meteo.com/v1/archive",
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error(f"Historical weather fetch failed: {e}")
        return {}


def extract_24h_rainfall(weather_data: Dict[str, Any]) -> float:
    """Extract next 24h accumulated rainfall in mm."""
    try:
        hourly = weather_data.get("hourly", {})
        precipitation = hourly.get("precipitation", [])
        # Next 24 readings (starting from first future hour)
        # past_days data = past_days * 24 hours
        past_hours = weather_data.get("past_days", 2) * 24
        next_24h = precipitation[past_hours: past_hours + 24]
        return round(sum(next_24h), 1)
    except (KeyError, TypeError, IndexError):
        return 25.0  # Conservative fallback


def extract_48h_rainfall(weather_data: Dict[str, Any]) -> float:
    """Extract next 48h accumulated rainfall in mm."""
    try:
        hourly = weather_data.get("hourly", {})
        precipitation = hourly.get("precipitation", [])
        past_hours = weather_data.get("past_days", 2) * 24
        next_48h = precipitation[past_hours: past_hours + 48]
        return round(sum(next_48h), 1)
    except (KeyError, TypeError, IndexError):
        return 50.0


def extract_72h_rainfall(weather_data: Dict[str, Any]) -> float:
    """Extract next 72h accumulated rainfall in mm."""
    try:
        hourly = weather_data.get("hourly", {})
        precipitation = hourly.get("precipitation", [])
        past_hours = weather_data.get("past_days", 2) * 24
        next_72h = precipitation[past_hours: past_hours + 72]
        return round(sum(next_72h), 1)
    except (KeyError, TypeError, IndexError):
        return 80.0


def extract_soil_moisture(weather_data: Dict[str, Any]) -> float:
    """Extract current soil moisture (0-7cm depth), 0-1 scale."""
    try:
        hourly = weather_data.get("hourly", {})
        sm = hourly.get("soil_moisture_0_to_7cm", [0.3])
        past_hours = weather_data.get("past_days", 2) * 24
        # Current value
        current = sm[past_hours] if past_hours < len(sm) else sm[-1]
        return float(current) if current is not None else 0.3
    except (KeyError, TypeError, IndexError):
        return 0.35


def extract_current_temp(weather_data: Dict[str, Any]) -> float:
    """Extract current temperature in Celsius."""
    try:
        hourly = weather_data.get("hourly", {})
        temps = hourly.get("temperature_2m", [30.0])
        past_hours = weather_data.get("past_days", 2) * 24
        return float(temps[past_hours] if past_hours < len(temps) else temps[-1])
    except (KeyError, TypeError, IndexError):
        return 30.0


def extract_hourly_precip_series(weather_data: Dict[str, Any], hours: int = 72) -> List[float]:
    """Extract hourly precipitation series for timeline charts."""
    try:
        hourly = weather_data.get("hourly", {})
        precipitation = hourly.get("precipitation", [])
        past_hours = weather_data.get("past_days", 2) * 24
        series = precipitation[past_hours: past_hours + hours]
        return [float(v) if v is not None else 0.0 for v in series]
    except (KeyError, TypeError):
        return [2.0] * hours


def _simulated_weather_data(lat: float, lon: float, forecast_days: int) -> Dict[str, Any]:
    """
    Fallback simulation when Open-Meteo API is unavailable.
    Uses location-aware seasonal estimates for South/Southeast Asia.
    """
    import math
    from datetime import date

    month = date.today().month
    # Monsoon season: June-September (South Asia)
    is_monsoon = 5 <= month <= 10

    base_rain = 8.0 if is_monsoon else 1.5
    hours = (forecast_days + 2) * 24  # include past_days=2

    hourly_precip = []
    for i in range(hours):
        # Simulate storm events
        noise = math.sin(i * 0.3 + lat) * 2
        storm_factor = 3 if (i % 18) < 4 else 1
        val = max(0, base_rain * storm_factor + noise)
        hourly_precip.append(round(val, 1))

    hourly_soil = [0.35 + (sum(hourly_precip[:i+1]) % 10) / 100 for i in range(hours)]
    hourly_temp = [30 + 4 * math.sin((i / 24) * 2 * math.pi) for i in range(hours)]

    return {
        "latitude": lat,
        "longitude": lon,
        "timezone": "Asia/Dhaka",
        "past_days": 2,
        "hourly": {
            "precipitation": hourly_precip,
            "soil_moisture_0_to_7cm": hourly_soil,
            "temperature_2m": hourly_temp,
            "relative_humidity_2m": [80.0] * hours,
            "wind_speed_10m": [15.0] * hours,
        },
        "daily": {
            "precipitation_sum": [sum(hourly_precip[i*24:(i+1)*24]) for i in range(forecast_days)],
            "temperature_2m_max": [33.0] * forecast_days,
            "temperature_2m_min": [24.0] * forecast_days,
        },
        "_simulated": True,
    }
