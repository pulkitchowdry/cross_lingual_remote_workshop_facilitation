from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import require_secret
from app.languages import is_supported
from app.models import nllb

router = APIRouter()

# Matches the typed-caption textarea's own maxLength in the Next.js app (see
# facilitator/page.tsx) — a ceiling this service enforces itself rather than relying
# entirely on upstream callers to bound it. nllb.translate() runs tokenizer.encode()
# under a single process-wide lock (see nllb.py), so one oversized request would
# otherwise stall every concurrent /translate call across every workshop session
# sharing this instance.
MAX_TEXT_LENGTH = 3000


class TranslateRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT_LENGTH)
    sourceLanguage: str
    targetLanguage: str


class TranslateResponse(BaseModel):
    text: str
    provider: str = "nllb"


@router.post("/translate", response_model=TranslateResponse, dependencies=[Depends(require_secret)])
def translate(request: TranslateRequest) -> TranslateResponse:
    if not is_supported(request.sourceLanguage) or not is_supported(request.targetLanguage):
        raise HTTPException(status_code=400, detail="Unsupported language.")
    try:
        translated = nllb.translate(request.text, request.sourceLanguage, request.targetLanguage)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Translation failed: {error}") from error
    return TranslateResponse(text=translated)
