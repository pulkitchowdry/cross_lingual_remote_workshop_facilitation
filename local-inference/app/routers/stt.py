from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
        text = whisper.transcribe(audio_bytes, expectedLanguage)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {error}") from error
    return TranscribeResponse(text=text)
