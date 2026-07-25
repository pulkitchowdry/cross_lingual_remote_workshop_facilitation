from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.auth import require_secret
from app.languages import is_supported
from app.models import piper

router = APIRouter()


class SynthesizeRequest(BaseModel):
    text: str
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
