from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import List
from datetime import datetime
import logging

from services.weather_service import fetch_weather_forecast, extract_current_temp, extract_24h_rainfall

logger = logging.getLogger(__name__)
router = APIRouter()


class WeatherResponse(BaseModel):
    lat: float
    lon: float
    temperature_c: float
    humidity_pct: float
    rainfall_today_mm: float
    rainfall_24h_mm: float
    rainfall_48h_mm: float
    rainfall_72h_mm: float
    wind_speed_kmh: float
    wind_direction_deg: float
    soil_moisture_0_7cm: float
    forecast_7d: List[dict]
    model_version: str
    data_source: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)


@router.get("/current", response_model=WeatherResponse)
async def get_current_weather(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """
    Current weather conditions from Open-Meteo (free, no API key).
    Includes 7-day daily forecast for planning.
    """
    try:
        data = await fetch_weather_forecast(lat, lon, forecast_days=7, past_days=0)
        
        hourly = data.get("hourly", {})
        daily = data.get("daily", {})

        def safe_get(lst, idx, default):
            try: return lst[idx] if lst and idx < len(lst) else default
            except: return default

        rain_today = safe_get(hourly.get("precipitation", []), 0, 0.0)
        # 24h sum
        precip_list = hourly.get("precipitation", [])
        rain_24h = round(sum(precip_list[:24]), 1) if precip_list else 20.0
        rain_48h = round(sum(precip_list[:48]), 1) if precip_list else 35.0
        rain_72h = round(sum(precip_list[:72]), 1) if precip_list else 50.0

        # Daily forecast
        forecast_7d = []
        dates = daily.get("time", [])
        for i, date in enumerate(dates[:7]):
            forecast_7d.append({
                "date": date,
                "precip_sum_mm": safe_get(daily.get("precipitation_sum", []), i, 0.0),
                "precip_prob_max_pct": safe_get(daily.get("precipitation_probability_max", []), i, 50),
                "temp_max_c": safe_get(daily.get("temperature_2m_max", []), i, 32.0),
                "temp_min_c": safe_get(daily.get("temperature_2m_min", []), i, 24.0),
            })

        return {
            "lat": lat,
            "lon": lon,
            "temperature_c": safe_get(hourly.get("temperature_2m", []), 0, 30.0),
            "humidity_pct": safe_get(hourly.get("relative_humidity_2m", []), 0, 80.0),
            "rainfall_today_mm": rain_today,
            "rainfall_24h_mm": rain_24h,
            "rainfall_48h_mm": rain_48h,
            "rainfall_72h_mm": rain_72h,
            "wind_speed_kmh": safe_get(hourly.get("wind_speed_10m", []), 0, 15.0),
            "wind_direction_deg": safe_get(hourly.get("wind_direction_10m", []), 0, 180.0),
            "soil_moisture_0_7cm": safe_get(hourly.get("soil_moisture_0_to_7cm", []), 0, 0.35),
            "forecast_7d": forecast_7d,
            "model_version": "open-meteo-v1",
            "data_source": "Open-Meteo (free, no API key required)",
            "generated_at": datetime.utcnow(),
        }

    except Exception as e:
        logger.error(f"Weather endpoint failed: {e}")
        # Return safe defaults
        return {
            "lat": lat,
            "lon": lon,
            "temperature_c": 30.0,
            "humidity_pct": 80.0,
            "rainfall_today_mm": 5.0,
            "rainfall_24h_mm": 25.0,
            "rainfall_48h_mm": 45.0,
            "rainfall_72h_mm": 70.0,
            "wind_speed_kmh": 15.0,
            "wind_direction_deg": 180.0,
            "soil_moisture_0_7cm": 0.35,
            "forecast_7d": [],
            "model_version": "fallback-v1",
            "data_source": "Simulated (API unavailable)",
            "generated_at": datetime.utcnow(),
        }
