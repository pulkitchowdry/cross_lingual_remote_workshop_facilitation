from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import require_secret
from app.languages import is_supported
from app.models import whisper

router = APIRouter()

# See translate.py's MAX_TEXT_LENGTH for why this service bounds request size
# itself. Audio can't be capped via a Pydantic Field(max_length=...) like the
# JSON text bodies in translate.py/tts.py — it arrives as a multipart file, not
# a validated model field — so it's checked explicitly below, after read()
# but before the CPU-bound transcribe call it's actually guarding.
# LocalBufferingSpeechToTextStream (src/lib/providers/local-speech-buffer.ts)
# only ever sends ~2.5s windows, which even as uncompressed 48kHz stereo PCM
# is well under 1MB; 10MB leaves generous headroom for that while still
# rejecting a runaway upload.
MAX_AUDIO_BYTES = 10 * 1024 * 1024


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
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large.")
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
