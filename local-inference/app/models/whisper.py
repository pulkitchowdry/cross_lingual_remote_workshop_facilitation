"""Speech-to-text via faster-whisper (CTranslate2-based Whisper), CPU/int8.
One-shot transcription per request, matching the Next.js side's chunked
buffering design (docs/TRANSLATION_ARCHITECTURE.md Part 5) — this service has
no notion of streaming or segment timing, only "these bytes -> this text"."""

import io
from functools import lru_cache

from faster_whisper import WhisperModel

from app.config import settings
from app.languages import WHISPER_CODE


@lru_cache(maxsize=1)
def _model() -> WhisperModel:
    return WhisperModel(
        f"{settings.model_root}/whisper-small",
        device="cpu",
        compute_type="int8",
        cpu_threads=settings.inference_threads,
    )


def is_loaded() -> bool:
    try:
        _model()
        return True
    except Exception:
        return False


def transcribe(audio_bytes: bytes, expected_language: str) -> str:
    segments, _info = _model().transcribe(
        io.BytesIO(audio_bytes),
        language=WHISPER_CODE[expected_language],
        beam_size=5,
    )
    return " ".join(segment.text.strip() for segment in segments).strip()
