"""Application settings loaded from environment (.env supported)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = (
        "postgresql+psycopg://projectpulse:projectpulse_dev_pw@127.0.0.1:5432/projectpulse"
    )
    test_database_url: str = (
        "postgresql+psycopg://projectpulse:projectpulse_dev_pw@127.0.0.1:5432/projectpulse_test"
    )

    session_secret: str = "dev-only-insecure-secret-change-me"
    session_cookie_name: str = "pp_session"
    session_ttl_hours: int = 72

    cors_origins: str = "http://localhost:5199,http://127.0.0.1:5199"

    llm_base_url: str = "https://integrate.api.nvidia.com/v1"
    llm_api_key: str = ""
    llm_model: str = "nvidia/nemotron-3.5-lightning-30b-a3b"
    llm_fallback_model: str = "deepseek-ai/deepseek-v4.1-flash"
    llm_timeout_seconds: int = 90
    embed_model: str = "BAAI/bge-small-en-v1.5"
    embed_dim: int = 2048
    demo_mode: bool = False

    max_upload_mb: int = 20
    storage_dir: str = "storage"

    api_host: str = "127.0.0.1"
    api_port: int = 8000

    @field_validator("database_url", "test_database_url", mode="after")
    @classmethod
    def _normalize_db_url(cls, value: str) -> str:
        """Accept managed-DB URL schemes (e.g. Render's postgres://) as psycopg URLs."""
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value[len("postgresql://") :]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def storage_path(self) -> Path:
        p = Path(self.storage_dir)
        if not p.is_absolute():
            p = BACKEND_ROOT / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def ai_configured(self) -> bool:
        return bool(self.llm_api_key) and not self.demo_mode

    @property
    def demo_sample_mode(self) -> bool:
        """True when we must NOT call a real provider (no key or forced)."""
        return self.demo_mode or not self.llm_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
