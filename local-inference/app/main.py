from fastapi import FastAPI

from app.models import nllb, piper, whisper
from app.routers import stt, translate, tts

# docs_url/redoc_url/openapi_url default to enabled with zero authentication — unlike
# every real inference route below (each explicitly gated by Depends(require_secret)),
# FastAPI's auto-generated /docs, /redoc, and /openapi.json would otherwise be
# reachable by anyone who finds this service's address, disclosing its full API
# surface. Disabled outright; there's no internal audience for interactive docs on
# this service that would justify gating them behind require_secret instead.
app = FastAPI(title="clrwf local-inference", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(translate.router)
app.include_router(stt.router)
app.include_router(tts.router)


@app.get("/health")
def health():
    """Unauthenticated — Railway's healthcheck hits this directly."""
    return {
        "status": "ok",
        "modelsLoaded": {
            "nllb": nllb.is_loaded(),
            "whisper": whisper.is_loaded(),
            "piper": piper.is_loaded(),
        },
    }
