from functools import lru_cache
from pathlib import Path
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
    auth_encryption_key: SecretStr = SecretStr("development-encryption-change-me")
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_days: int = 30
    invitation_ttl_hours: int = 48
    password_reset_ttl_hours: int = 2
    login_max_failures: int = 5
    login_lock_seconds: int = 15 * 60
    demo_password: SecretStr | None = None
    seed_demo_data: bool = False
    redis_url: str = "redis://127.0.0.1:6379/0"
    s3_endpoint: str = "127.0.0.1:9000"
    s3_access_key: str = "local"
    s3_secret_key: SecretStr = SecretStr("local-only")
    s3_secure: bool = False
    s3_bucket: str = "workspace-files"
    members_api_url: str = ""
    members_integration_key: SecretStr = SecretStr("")
    members_cache_seconds: int = 300
    attachment_max_bytes: int = 25 * 1024 * 1024
    voice_message_max_bytes: int = 4 * 1024 * 1024
    voice_message_max_duration_ms: int = 10 * 60 * 1000
    update_directory: Path = Path("var/desktop-updates")
    update_max_bytes: int = 350 * 1024 * 1024
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:5173", "http://localhost:5173"]
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
