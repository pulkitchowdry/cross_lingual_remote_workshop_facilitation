from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import require_secret
from app.languages import is_supported
from app.models import whisper

router = APIRouter()


class TranscribeResponse(BaseModel):
    text: str


@router.post(
    "/stt/transcribe",
    response_model=TranscribeResponse,
    dependencies=[Depends(require_secret)],
)
async def transcribe(
    audio: UploadFile = File(...),
    expectedLanguage: str = Form(...),
) -> TranscribeResponse:
    if not is_supported(expectedLanguage):
        raise HTTPException(status_code=400, detail="Unsupported language.")
    audio_bytes = await audio.read()
    if not audio_bytes:
        return TranscribeResponse(text="")
    try:
        # whisper.transcribe is CPU-bound and blocking; this handler is `async def`
        # only for `await audio.read()` above, so without run_in_threadpool the
        # transcription itself would run inline on the single ASGI event-loop
        # thread and stall every other concurrent request this instance is serving
        # (other /translate, /tts/synthesize, /stt/transcribe calls, even /health) —
        # unlike translate.py/tts.py's plain `def` handlers, which FastAPI/Starlette
        # already offload to a worker thread automatically.
        text = await run_in_threadpool(whisper.transcribe, audio_bytes, expectedLanguage)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {error}") from error
    return TranscribeResponse(text=text)
