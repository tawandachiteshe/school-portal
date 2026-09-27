from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads from environment / .env (see docs/06 §6.2 and docs/10 §10.7)."""

    # api/.env (if present) overrides the root .env when running outside Docker.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "development"
    app_url: str = "http://localhost:5173"
    secret_key: str = "dev-only-change-me"

    database_url: str = "postgresql+psycopg://portal:change-me@localhost:5432/portal"
    redis_url: str = "redis://localhost:6379/0"

    oidc_issuer: str = "http://localhost:9100/application/o/tcfl-portal/"
    oidc_internal_base_url: str = ""
    oidc_client_id: str = "tcfl-portal"
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = "http://localhost:5173/api/auth/callback"

    session_max_age: int = 1_209_600  # 14 days
    session_encryption_key: str = ""  # base64, 32 bytes; derived from secret_key when empty (dev only)
    # Sign in as a seeded user without Authentik. Never enabled in production.
    dev_login: bool = True

    ocr_llm_mode: str = "fallback"  # off | fallback | always
    claude_model: str = "claude-opus-5"
    assistant_enabled: bool = True

    @property
    def is_prod(self) -> bool:
        return self.app_env == "production"

    @property
    def dev_login_enabled(self) -> bool:
        return self.dev_login and not self.is_prod


@lru_cache
def get_settings() -> Settings:
    return Settings()
