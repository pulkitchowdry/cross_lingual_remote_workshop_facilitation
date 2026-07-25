from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_secret
from app.languages import is_supported
from app.models import nllb

router = APIRouter()


class TranslateRequest(BaseModel):
    text: str
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
