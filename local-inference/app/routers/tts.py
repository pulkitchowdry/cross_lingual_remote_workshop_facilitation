from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import require_secret
from app.languages import is_supported
from app.models import piper

router = APIRouter()

# NOT translate.py's MAX_TEXT_LENGTH (3000) reused — that number bounds the
# *original* caption/chat text (matching the Next.js app's own textarea maxLength)
# and protects NLLB's translate() call, which runs under a single process-wide
# tokenizer lock (see nllb.py) where one oversized request would stall every other
# concurrent /translate call. Neither reason applies here: this endpoint's input is
# already-*translated* text (src/app/api/captions/[segmentId]/audio/route.ts pulls
# it from segment.translations, never re-capped after translation), which can
# legitimately run longer than the original 3000-char input — translating into a
# more verbose target language routinely adds 15-25%, sometimes more. And
# piper.synthesize() (piper.py) holds no lock during synthesis, so an oversized
# request here doesn't stall concurrent callers the way an NLLB one would. This
# ceiling exists only to bound one synthesis request's own size/duration, with
# generous headroom above the original 3000-char cap for translation expansion.
MAX_TEXT_LENGTH = 6000


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
