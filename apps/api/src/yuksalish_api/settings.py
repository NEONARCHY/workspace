from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded only from the environment or a local .env file."""

    model_config = SettingsConfigDict(
        env_prefix="YUKSALISH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "staging", "production"] = "development"
    api_prefix: str = "/api/v1"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    database_url: str = "postgresql+asyncpg://yuksalish:local@127.0.0.1:5432/yuksalish"
    auth_signing_key: SecretStr = SecretStr("development-only-change-me")
    seed_demo_data: bool = False
    redis_url: str = "redis://127.0.0.1:6379/0"
    s3_endpoint: str = "127.0.0.1:9000"
    s3_access_key: str = "local"
    s3_secret_key: SecretStr = SecretStr("local-only")
    s3_secure: bool = False
    s3_bucket: str = "workspace-files"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:5173", "http://localhost:5173"]
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
