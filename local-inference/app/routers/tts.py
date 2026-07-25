from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import require_secret
from app.languages import is_supported
from app.models import piper

router = APIRouter()

# See translate.py's MAX_TEXT_LENGTH for why this service bounds request text itself.
MAX_TEXT_LENGTH = 3000


class SynthesizeRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT_LENGTH)
    language: str


@router.post("/tts/synthesize", dependencies=[Depends(require_secret)])
def synthesize(request: SynthesizeRequest) -> Response:
    if not is_supported(request.language):
        raise HTTPException(status_code=400, detail="Unsupported language.")
    try:
        audio = piper.synthesize(request.text, request.language)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {error}") from error
    return Response(content=audio, media_type="audio/wav", headers={"X-TTS-Provider": "piper"})
