"""Speech-to-text via faster-whisper (CTranslate2-based Whisper), CPU/int8.
One-shot transcription per request, matching the Next.js side's chunked
buffering design (docs/TRANSLATION_ARCHITECTURE.md Part 5) — this service has
no notion of streaming or segment timing, only "these bytes -> this text"."""

import io
import threading

from faster_whisper import WhisperModel

from app.config import settings
from app.languages import WHISPER_CODE

# Double-checked locking, not `@lru_cache`: `lru_cache` only serializes its own
# cache dict reads/writes, not the wrapped call — concurrent first callers (e.g.
# an unauthenticated /health poll landing next to a real request on cold start)
# would each construct their own full WhisperModel in parallel, multiplying
# memory right when the container is least able to afford it.
_model_lock = threading.Lock()
_model_instance: WhisperModel | None = None


def _model() -> WhisperModel:
    global _model_instance
    if _model_instance is None:
        with _model_lock:
            if _model_instance is None:
                _model_instance = WhisperModel(
                    f"{settings.model_root}/whisper-small",
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=settings.inference_threads,
                )
    return _model_instance


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
