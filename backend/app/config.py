from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cors_origins: str = "http://localhost:3000"
    reservation_ttl_seconds: int = 600
    max_websocket_message_bytes: int = 16384
    room_requests_per_minute: int = 20

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


settings = Settings()
