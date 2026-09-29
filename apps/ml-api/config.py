"""
Agri-SHIELD ML API Configuration
Environment variables with sensible defaults for development.
"""
from typing import Annotated, List

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    # Application
    environment: str = "development"
    port: int = 8000
    debug: bool = True
    version: str = "2.0.0"

    # CORS — JSON list or comma-separated string in CORS_ORIGINS
    cors_origins: Annotated[List[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://agrishield.io",
        "https://agri-shield.vercel.app",
    ]

    # Protects state-changing ML endpoints (POST /api/ml/retrain) when set
    ml_api_key: str = ""

    # Database (optional: pgvector retrieval for the advisor)
    database_url: str = ""

    # Redis (for BullMQ jobs)
    redis_url: str = "redis://localhost:6379"

    # External APIs — Open-Meteo (free, no key), SoilGrids (free, no key)
    open_meteo_base_url: str = "https://api.open-meteo.com/v1"
    open_meteo_flood_url: str = "https://flood-api.open-meteo.com/v1/flood"
    open_meteo_marine_url: str = "https://marine-api.open-meteo.com/v1/marine"
    soilgrids_base_url: str = "https://rest.isric.org/soilgrids/v2.0"
    live_timeout_s: float = 8.0

    # Twilio (SMS alerts) — optional, falls back to simulation
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # LLM provider chain for the advisor (first configured provider wins)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    ollama_base_url: str = ""
    ollama_model: str = "llama3.1:8b"
    llm_timeout_s: float = 35.0

    # Translation — DeepL if keyed, else MyMemory (free, no key)
    deepl_api_key: str = ""
    mymemory_email: str = ""

    # GloFAS (flood archive) — optional
    glofas_api_key: str = ""

    # Mapbox (satellite imagery) — optional
    mapbox_token: str = ""

    # JWT
    jwt_secret: str = "dev-secret-change-in-production-agrishield-2026"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 1 week

    # Model weights directory (relative paths resolve against apps/ml-api)
    model_weights_dir: str = "./model_weights"
    # Train from the committed dataset in the background when weights are missing
    train_on_startup: bool = True

    # Legacy flag kept for the /api/v1 formula endpoints
    use_simulation_mode: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json

                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


settings = Settings()
