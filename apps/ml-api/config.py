"""
Agri-SHIELD ML API Configuration
Environment variables with sensible defaults for development.
"""
from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # Application
    environment: str = "development"
    port: int = 8000
    debug: bool = True

    # CORS
    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://agrishield.io",
        "https://agri-shield.vercel.app",
    ]

    # Database
    database_url: str = "postgresql://agrishield:agrishield@localhost:5432/agrishield"

    # Redis (for BullMQ jobs)
    redis_url: str = "redis://localhost:6379"

    # External APIs
    # Open-Meteo: Free, no key needed
    open_meteo_base_url: str = "https://api.open-meteo.com/v1"

    # SoilGrids: Free, no key needed
    soilgrids_base_url: str = "https://rest.isric.org/soilgrids/v2.0"

    # Twilio (SMS alerts) — optional, falls back to simulation
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # OpenAI (AI Advisor RAG) — optional, falls back to rule-based responses
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # GloFAS (flood archive) — optional
    glofas_api_key: str = ""

    # Mapbox (satellite imagery) — optional
    mapbox_token: str = ""

    # JWT
    jwt_secret: str = "dev-secret-change-in-production-agrishield-2026"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 1 week

    # Model weights cache directory
    model_weights_dir: str = "./model_weights"

    # Simulation mode (uses domain formulas instead of trained models)
    use_simulation_mode: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


settings = Settings()
