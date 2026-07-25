from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Env-driven settings for the local-inference service. `LOCAL_INFERENCE_SECRET`
    unset means the service refuses every inference request (see auth.py) — there is
    no "open" mode, since this service is only ever reached from the Next.js app or
    the agent worker, never a browser."""

    local_inference_secret: str = ""
    inference_threads: int = 2
    port: int = 8080
    model_root: str = "/models"

    class Config:
        env_prefix = ""


settings = Settings()
