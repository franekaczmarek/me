from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings loaded from environment variables / backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Me API"
    # Comma-separated list of allowed frontend origins.
    cors_origins: str = "http://localhost:3000"

    supabase_url: str = ""
    supabase_anon_key: str = ""

    # Claude API key for the to-do planner; the planner is unavailable without it.
    anthropic_api_key: str = ""
    # Needed only for keys not scoped to a workspace (sent as the anthropic-workspace-id header).
    anthropic_workspace_id: str = ""

    # Fernet key that encrypts the stored Gmail app passwords; the Mail module is unavailable without it.
    mail_encryption_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
