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
# a validated model field — so it's checked explicitly below, while still
# streaming in (not after a single unbounded `await audio.read()`) so an
# oversized upload is rejected before it's ever fully buffered, not just before
# the CPU-bound transcribe call. Starlette's multipart parser only enforces a
# size cap on plain form fields (`expectedLanguage`), not an actual file part —
# a file part streams unbounded into a SpooledTemporaryFile, so this route
# can't rely on the framework to have already bounded `audio` by the time this
# handler runs. LocalBufferingSpeechToTextStream (src/lib/providers/
# local-speech-buffer.ts) only ever sends ~2.5s windows, which even as
# uncompressed 48kHz stereo PCM is well under 1MB; 10MB leaves generous
# headroom for that while still rejecting a runaway upload.
MAX_AUDIO_BYTES = 10 * 1024 * 1024
# Read granularity for the streaming size check below — small enough that an
# oversized upload is rejected only slightly past the real limit, large enough
# that a normal (well under the limit) upload isn't read in an excessive
# number of round trips.
READ_CHUNK_BYTES = 1024 * 1024


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

    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = await audio.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio file too large.")
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
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
