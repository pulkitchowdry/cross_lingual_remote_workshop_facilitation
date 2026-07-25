from fastapi import FastAPI

from app.models import nllb, piper, whisper
from app.routers import stt, translate, tts

app = FastAPI(title="clrwf local-inference")
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
